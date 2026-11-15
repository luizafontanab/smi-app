import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPaymentResult, provisionMember, recordMembershipCheckout } from "@/lib/membership";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

/**
 * lib/membership.ts, mocked. For applyPaymentResult()'s card-payment branch
 * what matters is the order of writes and what a Stripe retry of the same
 * event does — the end-to-end write is covered against the database in
 * stripe-webhook.test.ts (and the whole funnel in join-funnel.test.ts).
 */
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { enqueue, generateAndStoreInvoicePdf, notifyConsole } = vi.hoisted(() => ({
  enqueue: vi.fn(async () => {}),
  generateAndStoreInvoicePdf: vi.fn(async () => "m1/SMI-JOIN-X.pdf"),
  notifyConsole: vi.fn(async () => {}),
}));
vi.mock("@/lib/jobs", () => ({ enqueue }));
vi.mock("@/lib/notify-admin", () => ({ notifyConsole }));
vi.mock("@/lib/invoice-pdf", () => ({ generateAndStoreInvoicePdf }));
vi.mock("@/lib/adapters/payments", () => ({ paymentsAreLive: () => true }));

afterEach(() => {
  resetDbServerMocks();
  enqueue.mockClear();
  generateAndStoreInvoicePdf.mockClear();
  notifyConsole.mockClear();
});

function db(invoices: ReturnType<typeof queryBuilder>, members = queryBuilder(dbOk({ name: "Acme" }))) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ invoices: () => invoices, members: () => members }) })));
  return { invoices, members };
}

const sessionTaken = () => dbError('duplicate key value violates unique constraint "invoices_stripe_session_idx"', { code: "23505" });

describe("applyPaymentResult — a Stripe card payment", () => {
  it("claims the invoice on the session first, then records the rest once", async () => {
    const { invoices, members } = db(queryBuilder(dbOk({ id: "inv1" })));

    await expect(applyPaymentResult("m1", { kind: "paid" }, { sessionId: "cs_join_1" })).resolves.toBe(true);

    expect(invoices.insert).toHaveBeenCalledTimes(1);
    expect(invoices.insert).toHaveBeenCalledWith(expect.objectContaining({
      member_id: "m1", stripe_session_id: "cs_join_1", status: "paid", amount_pennies: 4000, number: expect.stringMatching(/^SMI-JOIN-/),
    }));
    expect(members.update).toHaveBeenCalledWith({ paid_at: expect.any(String) });
    expect(invoices.update).toHaveBeenCalledWith({ pdf_path: "m1/SMI-JOIN-X.pdf" });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "payment_receipt" }));
  });

  // Review finding 7: a Stripe retry used to raise a second invoice, PDF and receipt.
  it("does nothing at all on a retry of a session already recorded", async () => {
    const { members } = db(queryBuilder(sessionTaken()));

    // false tells recordMembershipCheckout not to announce the payment again.
    await expect(applyPaymentResult("m1", { kind: "paid" }, { sessionId: "cs_join_1" })).resolves.toBe(false);

    expect(members.update).not.toHaveBeenCalled();
    expect(generateAndStoreInvoicePdf).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("throws (so the webhook answers 500 and Stripe retries) when the claim can't be written", async () => {
    db(queryBuilder(dbError("connection reset")));
    await expect(applyPaymentResult("m1", { kind: "paid" }, { sessionId: "cs_join_1" })).rejects.toThrow(/connection reset/);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("releases the claim when paid_at can't be stamped, so the retry isn't skipped", async () => {
    const { invoices } = db(queryBuilder(dbOk({ id: "inv1" })), queryBuilder(dbError("members locked")));
    await expect(applyPaymentResult("m1", { kind: "paid" }, { sessionId: "cs_join_1" })).rejects.toThrow(/members locked/);
    expect(invoices.delete).toHaveBeenCalled();
    expect(invoices.eq).toHaveBeenCalledWith("id", "inv1");
  });

  it("records nothing, and says so, for a result that settles nothing", async () => {
    const { invoices, members } = db(queryBuilder(dbOk(null)));
    await expect(applyPaymentResult("m1", { kind: "redirect", url: "https://checkout.stripe.com/x" })).resolves.toBe(false);
    expect(invoices.insert).not.toHaveBeenCalled();
    expect(members.update).not.toHaveBeenCalled();
  });

  it("works as before with no session (the stubbed checkout): stamps, then inserts the invoice with its PDF", async () => {
    const { invoices, members } = db(queryBuilder(dbOk(null)));

    await applyPaymentResult("m1", { kind: "paid" });

    expect(members.update).toHaveBeenCalledWith({ paid_at: expect.any(String) });
    expect(invoices.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "paid", pdf_path: "m1/SMI-JOIN-X.pdf" }));
    expect(invoices.insert).toHaveBeenCalledWith(expect.not.objectContaining({ stripe_session_id: expect.anything() }));
  });
});

/**
 * #5, ADR 0003: the subscription id is a compare-and-swap (only where none is
 * stored, or it's this one). Zero rows back means the member already has a
 * different subscription. The fake doesn't filter, so each test sets what
 * the swap returns: `[{ id }]` for claimed, `[]` for a duplicate.
 */
describe("recordMembershipCheckout", () => {
  const claimed = () => queryBuilder(dbOk([{ id: "m1" }]));
  const alreadySubscribed = () => queryBuilder(dbOk([]));
  const recordedInvoice = () => queryBuilder(dbOk({ id: "inv1", number: "SMI-JOIN-2026-0007" }));
  const CHECKOUT = { sessionId: "cs_join_2", subscriptionId: "sub_2", customerId: "cus_2" };

  it("first payment: stores the subscription and customer, records the invoice, tells Jas it's paid", async () => {
    const { members, invoices } = db(recordedInvoice(), claimed());

    await expect(recordMembershipCheckout("m1", CHECKOUT)).resolves.toBe(true);

    expect(members.update).toHaveBeenCalledWith({ stripe_subscription_id: "sub_2", stripe_customer_id: "cus_2" });
    expect(members.or).toHaveBeenCalledWith("stripe_subscription_id.is.null,stripe_subscription_id.eq.sub_2");
    expect(invoices.insert).toHaveBeenCalledWith(expect.objectContaining({ stripe_session_id: "cs_join_2", status: "paid" }));
    expect(notifyConsole).toHaveBeenCalledTimes(1);
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({ kind: "payment_taken", memberId: "m1" }));
  });

  it("a same-subscription retry announces nothing a second time", async () => {
    db(queryBuilder(sessionTaken()), claimed());

    await expect(recordMembershipCheckout("m1", CHECKOUT)).resolves.toBe(false);

    expect(notifyConsole).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a second subscription keeps the first tracked, records the payment, and alerts Jas instead of payment_taken", async () => {
    const { members, invoices } = db(recordedInvoice(), alreadySubscribed());

    await expect(recordMembershipCheckout("m1", CHECKOUT)).resolves.toBe(true);

    // The only subscription write is the guarded swap, which matched no row.
    expect(members.update).toHaveBeenCalledTimes(2);
    expect(members.update).toHaveBeenCalledWith({ stripe_subscription_id: "sub_2", stripe_customer_id: "cus_2" });
    expect(members.update).toHaveBeenCalledWith({ paid_at: expect.any(String) });
    expect(members.or).toHaveBeenCalledWith("stripe_subscription_id.is.null,stripe_subscription_id.eq.sub_2");
    // The £40 was taken, so the books record it.
    expect(invoices.insert).toHaveBeenCalledWith(expect.objectContaining({ stripe_session_id: "cs_join_2", status: "paid", amount_pennies: 4000 }));
    expect(notifyConsole).toHaveBeenCalledTimes(1);
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({
      kind: "duplicate_subscription",
      memberId: "m1",
      payload: { member_id: "m1" },
      message: expect.stringMatching(/sub_2[\s\S]*refund[\s\S]*void invoice SMI-JOIN-2026-0007/),
    }));
    expect(notifyConsole).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "payment_taken" }));
  });

  it("a Stripe retry of the duplicate's event doesn't alert twice", async () => {
    db(queryBuilder(sessionTaken()), alreadySubscribed());

    await expect(recordMembershipCheckout("m1", CHECKOUT)).resolves.toBe(false);

    expect(notifyConsole).not.toHaveBeenCalled();
  });

  it("throws before recording when the subscription can't be stored, so the retry redoes it all", async () => {
    const { invoices } = db(recordedInvoice(), queryBuilder(dbError("members locked")));

    await expect(recordMembershipCheckout("m1", CHECKOUT)).rejects.toThrow(/members locked/);

    expect(invoices.insert).not.toHaveBeenCalled();
    expect(notifyConsole).not.toHaveBeenCalled();
  });

  it("with no subscription (the hosted redirect without one) records the payment as before", async () => {
    const { members } = db(recordedInvoice(), claimed());

    await expect(recordMembershipCheckout("m1", { sessionId: "cs_join_3", subscriptionId: null, customerId: null })).resolves.toBe(true);

    expect(members.or).not.toHaveBeenCalled();
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({ kind: "payment_taken" }));
  });
});

describe("provisionMember", () => {
  function provisionDb() {
    const members = queryBuilder(dbOk({ id: "m1" }));
    const auth = { admin: { createUser: vi.fn(async () => dbOk({ user: { id: "u1" } })), deleteUser: vi.fn() } };
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ members: () => members, profiles: () => queryBuilder(), notification_prefs: () => queryBuilder() }),
      auth,
    })));
    return members;
  }
  const join = (website?: string) =>
    provisionMember({ email: "ops@acme.example", password: "correct horse battery", company: "Acme Ltd", ...(website === undefined ? {} : { website }) });

  it("stores the website typed at signup as an absolute link", async () => {
    const members = provisionDb();
    expect(await join("www.acme.co.uk")).toEqual({ memberId: "m1" });
    expect(members.insert).toHaveBeenCalledWith(expect.objectContaining({ website: "https://www.acme.co.uk" }));
  });

  it("keeps an explicit http(s) link as typed", async () => {
    const members = provisionDb();
    await join("http://acme.example/about");
    expect(members.insert).toHaveBeenCalledWith(expect.objectContaining({ website: "http://acme.example/about" }));
  });

  it("drops a website that can't be a link rather than storing it", async () => {
    const members = provisionDb();
    await join("javascript:alert(1)");
    expect(members.insert).toHaveBeenCalledWith(expect.not.objectContaining({ website: expect.anything() }));
    const again = provisionDb();
    await join("see our LinkedIn");
    expect(again.insert).toHaveBeenCalledWith(expect.not.objectContaining({ website: expect.anything() }));
  });
});
