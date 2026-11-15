import { afterEach, describe, expect, it, vi } from "vitest";
import { payMembership } from "@/app/dashboard/pay/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { RedirectSignal } from "../stubs/next-navigation";
import type { CurrentUser } from "@/lib/auth";
import type { CheckoutResult } from "@/lib/adapters/payments";
import type { MembershipCheckoutComplete } from "@/lib/membership-checkout";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const {
  requireMember, createCheckout, paymentsAreLive, applyPaymentResult, recordMembershipCheckout, notifyAdminFunnel,
  openMembershipCheckout, cancelOpenMembershipCheckout,
} = vi.hoisted(() => ({
  requireMember: vi.fn(async (): Promise<CurrentUser & { memberId: string }> => ({
    userId: "u1", email: "member@acme.example", role: "member", memberId: "mem1", displayName: "Acme",
  })),
  createCheckout: vi.fn<() => Promise<CheckoutResult>>(async () => ({ kind: "paid" })),
  paymentsAreLive: vi.fn(() => false),
  applyPaymentResult: vi.fn(async () => {}),
  recordMembershipCheckout: vi.fn(async () => true),
  notifyAdminFunnel: vi.fn(async () => {}),
  openMembershipCheckout: vi.fn<() => Promise<CheckoutResult | MembershipCheckoutComplete>>(async () => ({ kind: "paid" })),
  cancelOpenMembershipCheckout: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireMember }));
vi.mock("@/lib/adapters/payments", () => ({ getPayments: () => ({ createCheckout }), paymentsAreLive }));
vi.mock("@/lib/membership", () => ({ applyPaymentResult, recordMembershipCheckout }));
vi.mock("@/lib/membership-checkout", () => ({ openMembershipCheckout, cancelOpenMembershipCheckout }));
vi.mock("@/lib/notify-admin", () => ({ notifyAdminFunnel }));

afterEach(() => {
  resetDbServerMocks();
  vi.clearAllMocks();
});

const PREV = { message: "" };
const memberRow = (over: Record<string, unknown> = {}) =>
  queryBuilder(dbOk({
    id: "mem1", name: "Acme", paid_at: null, comped_until: null,
    membership_checkout_session_id: null, membership_checkout_expires_at: null, ...over,
  }));

function form(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("payMembership", () => {
  it("records a stub payment, notifies the funnel, and redirects to the dashboard", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));

    await expect(payMembership(PREV, form())).rejects.toThrow(RedirectSignal);
    // A card payment goes through the stored-checkout reuse (#5), not straight to the adapter.
    expect(openMembershipCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mem1", membership_checkout_session_id: null }),
      { memberId: "mem1", email: "member@acme.example", companyName: "Acme" },
      expect.objectContaining({ createCheckout }),
    );
    expect(createCheckout).not.toHaveBeenCalled();
    expect(applyPaymentResult).toHaveBeenCalledWith("mem1", { kind: "paid" });
    expect(notifyAdminFunnel).toHaveBeenCalled();
  });

  it("refuses to charge twice: an already-paid member is bounced to the dashboard before checkout", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow({ paid_at: "2026-08-01T00:00:00Z" }) })));

    await expect(payMembership(PREV, form())).rejects.toThrow(RedirectSignal);
    expect(createCheckout).not.toHaveBeenCalled();
    expect(openMembershipCheckout).not.toHaveBeenCalled();
    expect(applyPaymentResult).not.toHaveBeenCalled();
  });

  it("a comped member is likewise bounced before checkout", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow({ comped_until: "2027-01-01" }) })));

    await expect(payMembership(PREV, form())).rejects.toThrow(RedirectSignal);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("surfaces a checkout error as a form message without applying anything", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));
    createCheckout.mockResolvedValueOnce({ kind: "error", message: "Unknown promo code." });

    expect(await payMembership(PREV, form({ promo: "NOPE" }))).toEqual({ message: "Unknown promo code." });
    expect(applyPaymentResult).not.toHaveBeenCalled();
    expect(notifyAdminFunnel).not.toHaveBeenCalled();
  });

  it("passes the promo code through and reports the comped months to the funnel", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));
    createCheckout.mockResolvedValueOnce({ kind: "comped", months: 12 });

    await expect(payMembership(PREV, form({ promo: "smi-free-year" }))).rejects.toThrow(RedirectSignal);
    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({ promoCode: "smi-free-year" }));
    expect(applyPaymentResult).toHaveBeenCalledWith("mem1", { kind: "comped", months: 12 });
    expect(openMembershipCheckout).not.toHaveBeenCalled();
    // #5: the free promo ends any card checkout still open in another tab.
    expect(cancelOpenMembershipCheckout).toHaveBeenCalledWith(expect.objectContaining({ id: "mem1" }));
    expect(notifyAdminFunnel).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("12 months"),
    }));
  });

  it("says \"1 month\", not \"1 months\", for a single comped month", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));
    createCheckout.mockResolvedValueOnce({ kind: "comped", months: 1 });

    await expect(payMembership(PREV, form({ promo: "smi-one" }))).rejects.toThrow(RedirectSignal);
    expect(notifyAdminFunnel).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("comped 1 month."),
    }));
    // The promo code is echoed upper-cased so it is greppable in the console note.
    expect(notifyAdminFunnel).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("SMI-ONE"),
    }));
  });

  it("drops the \"(simulated)\" note once Stripe is live", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));
    paymentsAreLive.mockReturnValueOnce(true);

    await expect(payMembership(PREV, form())).rejects.toThrow(RedirectSignal);
    expect(notifyAdminFunnel).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Paid £40/month by card."),
    }));
    expect(notifyAdminFunnel).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.not.stringContaining("simulated"),
    }));
  });

  it("a live-Stripe redirect result goes straight to the checkout URL with nothing applied", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));
    openMembershipCheckout.mockResolvedValueOnce({ kind: "redirect", url: "https://checkout.stripe.test/cs_1" });

    await expect(payMembership(PREV, form())).rejects.toThrow("https://checkout.stripe.test/cs_1");
    expect(applyPaymentResult).not.toHaveBeenCalled();
  });

  // GAPS B1.7: the form opens Stripe's embedded Checkout with this; the payment
  // is recorded only once Stripe confirms it (webhook or return page).
  it("an embedded result hands the session to the form and records nothing", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow() })));
    openMembershipCheckout.mockResolvedValueOnce({
      kind: "embedded", clientSecret: "cs_1_secret_x", sessionId: "cs_1", expiresAt: "2026-11-15T12:00:00.000Z",
    });

    expect(await payMembership(PREV, form())).toEqual({ message: "", clientSecret: "cs_1_secret_x" });
    expect(applyPaymentResult).not.toHaveBeenCalled();
    expect(notifyAdminFunnel).not.toHaveBeenCalled();
  });

  // #5: the stored checkout was paid in another tab — record it, open nothing new.
  it("a stored checkout already completed is recorded as the payment", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow({ membership_checkout_session_id: "cs_1" }) })));
    openMembershipCheckout.mockResolvedValueOnce({ kind: "complete", sessionId: "cs_1", paid: true, subscriptionId: "sub_1", customerId: "cus_1" });

    await expect(payMembership(PREV, form())).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=paid");
    expect(recordMembershipCheckout).toHaveBeenCalledWith("mem1", { sessionId: "cs_1", subscriptionId: "sub_1", customerId: "cus_1" });
    expect(createCheckout).not.toHaveBeenCalled();
    expect(applyPaymentResult).not.toHaveBeenCalled();
    expect(notifyAdminFunnel).not.toHaveBeenCalled();
  });

  it("a completed checkout whose payment Stripe is still settling records nothing yet", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow({ membership_checkout_session_id: "cs_1" }) })));
    openMembershipCheckout.mockResolvedValueOnce({ kind: "complete", sessionId: "cs_1", paid: false, subscriptionId: "sub_1", customerId: "cus_1" });

    expect((await payMembership(PREV, form())).message).toMatch(/still being confirmed/);
    expect(recordMembershipCheckout).not.toHaveBeenCalled();
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("a promo code that doesn't redeem leaves the open card checkout alone", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => memberRow({ membership_checkout_session_id: "cs_1" }) })));
    createCheckout.mockResolvedValueOnce({ kind: "error", message: "Unknown promo code." });

    await payMembership(PREV, form({ promo: "NOPE" }));
    expect(cancelOpenMembershipCheckout).not.toHaveBeenCalled();
  });

  it("fails soft when the member row cannot be loaded", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(null)) })));

    expect((await payMembership(PREV, form())).message).toMatch(/sign in again/);
    expect(createCheckout).not.toHaveBeenCalled();
  });
});
