import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelOpenMembershipCheckout, openMembershipCheckout, type StoredMembershipCheckout } from "@/lib/membership-checkout";
import { serviceDb } from "@/lib/db/server";
import type { CheckoutResult, Payments } from "@/lib/adapters/payments";
import type { CheckoutSessionState, ExpireResult } from "@/lib/adapters/advert-checkout";
import { asDb, dbError, dbOk, fromByTable, mockDb, readThenUpdate } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

/**
 * #5, ADR 0003: one payable membership checkout per member. Stripe is faked
 * at the adapter seam: session reads and expiries through advert-checkout's
 * helpers, creation through a fake `Payments`.
 */
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { retrieveCheckoutSession, expireCheckoutSession, logError } = vi.hoisted(() => ({
  retrieveCheckoutSession: vi.fn<(id: string) => Promise<CheckoutSessionState | null>>(async () => null),
  expireCheckoutSession: vi.fn<(id: string) => Promise<ExpireResult>>(async () => ({ ok: true })),
  logError: vi.fn(),
}));
vi.mock("@/lib/adapters/advert-checkout", () => ({ retrieveCheckoutSession, expireCheckoutSession }));
vi.mock("@/lib/log", () => ({ logError }));

afterEach(() => {
  resetDbServerMocks();
  vi.clearAllMocks();
  retrieveCheckoutSession.mockReset().mockResolvedValue(null);
  expireCheckoutSession.mockReset().mockResolvedValue({ ok: true });
});

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const REQ = { memberId: "mem1", email: "a@acme.example", companyName: "Acme" };

const member = (sessionId: string | null, expiresAt: string | null = sessionId ? minutesFromNow(45) : null): StoredMembershipCheckout => ({
  id: "mem1", membership_checkout_session_id: sessionId, membership_checkout_expires_at: expiresAt,
});

const session = (over: Partial<CheckoutSessionState> = {}): CheckoutSessionState => ({
  status: "open", paymentStatus: "unpaid", invoiceId: null, kind: "membership",
  clientSecret: "cs_old_secret", amountTotal: 4000, currency: "gbp",
  clientReferenceId: "mem1", memberId: "mem1", subscriptionId: null, customerId: null, ...over,
});

function payments(result: CheckoutResult = {
  kind: "embedded", clientSecret: "cs_new_secret", sessionId: "cs_new", expiresAt: minutesFromNow(60),
}) {
  const createCheckout = vi.fn(async () => result);
  return { createCheckout, impl: { createCheckout, cancelSubscription: vi.fn(), keepRenewing: vi.fn() } as unknown as Payments };
}

/** The members table: `write` is what the compare-and-swap returns, `row` what a re-read finds. */
function db(write = dbOk([{ id: "mem1" }]) as ReturnType<typeof dbOk> | ReturnType<typeof dbError>, row: Record<string, unknown> | null = null) {
  const members = readThenUpdate(row, write);
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ members: () => members }) })));
  return members;
}

const order = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0];

describe("openMembershipCheckout", () => {
  it("hands back the stored open session and creates nothing at Stripe", async () => {
    const members = db();
    retrieveCheckoutSession.mockResolvedValue(session());
    const { createCheckout, impl } = payments();
    const stored = member("cs_old");

    const result = await openMembershipCheckout(stored, REQ, impl);

    expect(result).toEqual({ kind: "embedded", clientSecret: "cs_old_secret", sessionId: "cs_old", expiresAt: stored.membership_checkout_expires_at });
    expect(retrieveCheckoutSession).toHaveBeenCalledWith("cs_old");
    expect(createCheckout).not.toHaveBeenCalled();
    expect(expireCheckoutSession).not.toHaveBeenCalled();
    expect(members.update).not.toHaveBeenCalled();
  });

  it("expires a nearly-expired stored session before creating and storing its replacement", async () => {
    const members = db();
    retrieveCheckoutSession.mockResolvedValue(session());
    const { createCheckout, impl } = payments();

    const result = await openMembershipCheckout(member("cs_old", minutesFromNow(2)), REQ, impl);

    expect(result).toMatchObject({ kind: "embedded", clientSecret: "cs_new_secret", sessionId: "cs_new" });
    expect(expireCheckoutSession).toHaveBeenCalledWith("cs_old");
    expect(order(expireCheckoutSession)).toBeLessThan(order(createCheckout));
    expect(createCheckout).toHaveBeenCalledWith({ ...REQ, replacesSessionId: "cs_old" });
    expect(members.update).toHaveBeenCalledWith({ membership_checkout_session_id: "cs_new", membership_checkout_expires_at: expect.any(String) });
    // Compare-and-swap on the session being replaced.
    expect(members.eq).toHaveBeenCalledWith("membership_checkout_session_id", "cs_old");
  });

  it("expires an open stored session that came back with no client secret, then replaces it", async () => {
    const members = db();
    retrieveCheckoutSession.mockResolvedValue(session({ clientSecret: null }));
    const { createCheckout, impl } = payments();

    await openMembershipCheckout(member("cs_old"), REQ, impl);

    expect(expireCheckoutSession).toHaveBeenCalledWith("cs_old");
    expect(order(expireCheckoutSession)).toBeLessThan(order(createCheckout));
    expect(members.update).toHaveBeenCalledWith(expect.objectContaining({ membership_checkout_session_id: "cs_new" }));
  });

  it("creates and stores the first session against an empty slot", async () => {
    const members = db();
    const { createCheckout, impl } = payments();

    const result = await openMembershipCheckout(member(null), REQ, impl);

    expect(result).toMatchObject({ kind: "embedded", sessionId: "cs_new" });
    expect(retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(createCheckout).toHaveBeenCalledWith({ ...REQ, replacesSessionId: null });
    expect(members.is).toHaveBeenCalledWith("membership_checkout_session_id", null);
  });

  it("reports a stored session that was completed as paid, and opens nothing new", async () => {
    db();
    retrieveCheckoutSession.mockResolvedValue(session({ status: "complete", paymentStatus: "paid", subscriptionId: "sub_1", customerId: "cus_1" }));
    const { createCheckout, impl } = payments();

    const result = await openMembershipCheckout(member("cs_old"), REQ, impl);

    expect(result).toEqual({ kind: "complete", sessionId: "cs_old", paid: true, subscriptionId: "sub_1", customerId: "cus_1" });
    expect(createCheckout).not.toHaveBeenCalled();
    expect(expireCheckoutSession).not.toHaveBeenCalled();
  });

  it("reports paid when the session completes while it is being expired", async () => {
    db();
    retrieveCheckoutSession
      .mockResolvedValueOnce(session({ clientSecret: null }))
      .mockResolvedValueOnce(session({ status: "complete", paymentStatus: "paid", subscriptionId: "sub_1" }));
    expireCheckoutSession.mockResolvedValueOnce({ ok: false, status: "complete", error: "already complete" });
    const { createCheckout, impl } = payments();

    const result = await openMembershipCheckout(member("cs_old"), REQ, impl);

    expect(result).toMatchObject({ kind: "complete", sessionId: "cs_old", paid: true });
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("refuses to open a second session while the old one can't be expired", async () => {
    db();
    retrieveCheckoutSession.mockResolvedValue(session({ clientSecret: null }));
    expireCheckoutSession.mockResolvedValueOnce({ ok: false, status: "open", error: "Stripe 500" });
    const { createCheckout, impl } = payments();

    const result = await openMembershipCheckout(member("cs_old"), REQ, impl);

    expect(result.kind).toBe("error");
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("never reuses a stored session that isn't this member's membership checkout", async () => {
    db();
    retrieveCheckoutSession.mockResolvedValue(session({ clientReferenceId: "someone-else" }));
    const { createCheckout, impl } = payments();

    const result = await openMembershipCheckout(member("cs_old"), REQ, impl);

    expect(result).toMatchObject({ sessionId: "cs_new" });
    expect(createCheckout).toHaveBeenCalled();
  });

  it("two concurrent requests: the loser expires its own session and gets the winner's", async () => {
    // The swap matched no row: the winner had already stored cs_winner.
    db(dbOk([]), { membership_checkout_session_id: "cs_winner", membership_checkout_expires_at: minutesFromNow(60) });
    retrieveCheckoutSession.mockResolvedValue(session({ clientSecret: "cs_winner_secret" }));
    const { impl } = payments();

    const result = await openMembershipCheckout(member(null), REQ, impl);

    expect(expireCheckoutSession).toHaveBeenCalledWith("cs_new");
    expect(expireCheckoutSession).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: "embedded", clientSecret: "cs_winner_secret", sessionId: "cs_winner" });
  });

  it("two concurrent requests that got the same session back (same Idempotency-Key) both use it", async () => {
    db(dbOk([]), { membership_checkout_session_id: "cs_new", membership_checkout_expires_at: minutesFromNow(60) });
    const { impl } = payments();

    const result = await openMembershipCheckout(member(null), REQ, impl);

    expect(result).toMatchObject({ kind: "embedded", sessionId: "cs_new", clientSecret: "cs_new_secret" });
    expect(expireCheckoutSession).not.toHaveBeenCalled();
  });

  it("expires the new session when it can't be stored", async () => {
    db(dbError("members locked"));
    const { impl } = payments();

    const result = await openMembershipCheckout(member(null), REQ, impl);

    expect(result).toEqual({ kind: "error", message: expect.stringContaining("members locked") });
    expect(expireCheckoutSession).toHaveBeenCalledWith("cs_new");
  });

  it("passes a non-embedded result through without storing anything (hosted redirect, local stub)", async () => {
    const members = db();
    const { impl } = payments({ kind: "redirect", url: "https://checkout.stripe.test/cs_1" });

    expect(await openMembershipCheckout(member(null), REQ, impl)).toEqual({ kind: "redirect", url: "https://checkout.stripe.test/cs_1" });
    expect(members.update).not.toHaveBeenCalled();
  });
});

describe("cancelOpenMembershipCheckout (promo code redeemed)", () => {
  it("expires the stored open session at Stripe and clears it", async () => {
    const members = db();

    await cancelOpenMembershipCheckout(member("cs_old"));

    expect(expireCheckoutSession).toHaveBeenCalledWith("cs_old");
    expect(members.update).toHaveBeenCalledWith({ membership_checkout_session_id: null, membership_checkout_expires_at: null });
    expect(members.eq).toHaveBeenCalledWith("membership_checkout_session_id", "cs_old");
  });

  it("does nothing when no checkout is stored", async () => {
    const members = db();

    await cancelOpenMembershipCheckout(member(null));

    expect(expireCheckoutSession).not.toHaveBeenCalled();
    expect(members.update).not.toHaveBeenCalled();
  });

  it("keeps the session on the member, and logs, when Stripe won't expire it", async () => {
    const members = db();
    expireCheckoutSession.mockResolvedValueOnce({ ok: false, status: "open", error: "Stripe 500" });

    await cancelOpenMembershipCheckout(member("cs_old"));

    expect(members.update).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });
});
