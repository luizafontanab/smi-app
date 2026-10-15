import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The advert-invoice branch of /api/stripe/webhook (6 Oct), mocked rather
 * than run against the database like stripe-webhook.test.ts: what matters
 * here is routing — an advert payment must settle its invoice and must NEVER
 * reach the membership path, which would stamp the £40 join fee as paid.
 */
const { settleInvoice, applyPaymentResult, logError, notifyConsole } = vi.hoisted(() => ({
  settleInvoice: vi.fn<(...args: unknown[]) => Promise<import("@/lib/advert-payments").SettleResult>>(async () => ({ settled: true, memberId: "m1" })),
  applyPaymentResult: vi.fn(async () => {}),
  logError: vi.fn(),
  notifyConsole: vi.fn(async () => {}),
}));
vi.mock("@/lib/advert-payments", () => ({ settleInvoice, formatPounds: (p: number) => `£${(p / 100).toFixed(2)}` }));
vi.mock("@/lib/membership", () => ({ applyPaymentResult, applyPaymentFailure: vi.fn(), applySubscriptionEnded: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));
vi.mock("@/lib/notify-admin", () => ({ notifyConsole }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

import { POST } from "@/app/api/stripe/webhook/route";

const SECRET = "whsec_unit";

function signed(event: unknown, header?: (t: string, v1: string) => string) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000).toString();
  const v1 = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": header ? header(t, v1) : `t=${t},v1=${v1}` },
    body,
  }) as never;
}

const session = (extra: Record<string, unknown> = {}) => ({
  id: "cs_test_1",
  client_reference_id: "m1",
  payment_status: "paid",
  amount_total: 65000,
  currency: "gbp",
  metadata: { kind: "advert_invoice", invoice_id: "inv1", member_id: "m1" },
  ...extra,
});

beforeEach(() => vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET));
afterEach(() => {
  vi.unstubAllEnvs();
  settleInvoice.mockReset().mockResolvedValue({ settled: true, memberId: "m1" });
  applyPaymentResult.mockClear();
  logError.mockClear();
  notifyConsole.mockClear();
});

const SETTLE_OPTS = { sessionId: "cs_test_1", paid: { amountPennies: 65000, currency: "gbp" } };

describe("/api/stripe/webhook — advert invoices", () => {
  it("settles the invoice a paid advert session was for, and leaves membership alone", async () => {
    const res = await POST(signed({ type: "checkout.session.completed", data: { object: session() } }));
    expect(res.status).toBe(200);
    expect(settleInvoice).toHaveBeenCalledWith("inv1", SETTLE_OPTS);
    expect(applyPaymentResult).not.toHaveBeenCalled();
    expect(notifyConsole).not.toHaveBeenCalled();
  });

  it("waits on a session that completed unpaid (a delayed bank payment), then settles on async success", async () => {
    await POST(signed({ type: "checkout.session.completed", data: { object: session({ payment_status: "unpaid" }) } }));
    expect(settleInvoice).not.toHaveBeenCalled();

    await POST(signed({ type: "checkout.session.async_payment_succeeded", data: { object: session() } }));
    expect(settleInvoice).toHaveBeenCalledWith("inv1", SETTLE_OPTS);
    expect(applyPaymentResult).not.toHaveBeenCalled();
  });

  // Review finding 13: the two "nothing to settle" events for an advert session.
  it.each(["checkout.session.async_payment_failed", "checkout.session.expired"])(
    "acknowledges %s on an advert session, settles nothing and never reaches membership",
    async (type) => {
      const res = await POST(signed({ type, data: { object: session({ payment_status: "unpaid" }) } }));
      expect(res.status).toBe(200);
      expect(settleInvoice).not.toHaveBeenCalled();
      expect(applyPaymentResult).not.toHaveBeenCalled();
      expect(notifyConsole).not.toHaveBeenCalled();
    },
  );

  // Review finding 1: a DB error used to answer 200, so Stripe never retried.
  it("answers 500 when the payment can't be recorded, so Stripe retries", async () => {
    settleInvoice.mockRejectedValueOnce(new Error("settleInvoice inv1: connection reset"));
    const res = await POST(signed({ type: "checkout.session.completed", data: { object: session() } }));
    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ source: "webhook" }));
  });

  it("treats a replay of the session that already paid as harmless — no alert", async () => {
    settleInvoice.mockResolvedValueOnce({ settled: false, reason: "paid", paidSessionId: "cs_test_1", memberId: "m1" });
    const res = await POST(signed({ type: "checkout.session.completed", data: { object: session() } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ settled: false, replay: true });
    expect(logError).not.toHaveBeenCalled();
    expect(notifyConsole).not.toHaveBeenCalled();
  });

  it.each([
    [{ settled: false, reason: "paid", paidSessionId: "cs_other", memberId: "m1" }, "already paid by another checkout session"],
    [{ settled: false, reason: "void", memberId: "m1" }, "cancelled (void)"],
    [{ settled: false, reason: "amount_mismatch", memberId: "m1" }, "doesn't match"],
  ] as const)("alerts Jas and logs loudly when a payment settles nothing it should (%o)", async (result, why) => {
    settleInvoice.mockResolvedValueOnce(result);
    const res = await POST(signed({ type: "checkout.session.completed", data: { object: session() } }));
    expect(res.status).toBe(200); // retrying can't change the outcome — a person has to
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ source: "webhook", area: `stripe-webhook:advert-unowed:${result.reason}` }));
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({
      kind: "payment_taken",
      memberId: "m1",
      message: expect.stringMatching(new RegExp(`refund.*£650\\.00 GBP.*cs_test_1.*${why.replace(/[()]/g, "\\$&")}`)),
    }));
  });

  it("passes on a session with no amount as a mismatch to refuse, never as a blank cheque", async () => {
    await POST(signed({ type: "checkout.session.completed", data: { object: session({ amount_total: undefined, currency: undefined }) } }));
    expect(settleInvoice).toHaveBeenCalledWith("inv1", { sessionId: "cs_test_1", paid: { amountPennies: null, currency: null } });
  });

  it("still routes a membership checkout to the membership path", async () => {
    await POST(signed({ type: "checkout.session.completed", data: { object: { client_reference_id: "m1" } } }));
    expect(applyPaymentResult).toHaveBeenCalledWith("m1", { kind: "paid" }, {});
    expect(settleInvoice).not.toHaveBeenCalled();
  });

  // Review finding 7: a retried event duplicated the join invoice and receipt.
  it("keys a membership payment on its Checkout Session, so a retry can be recognised", async () => {
    await POST(signed({ type: "checkout.session.completed", data: { object: { id: "cs_join_1", client_reference_id: "m1" } } }));
    expect(applyPaymentResult).toHaveBeenCalledWith("m1", { kind: "paid" }, { sessionId: "cs_join_1" });
  });

  it("rejects a forged advert event", async () => {
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body: JSON.stringify({ type: "checkout.session.completed", data: { object: session() } }),
    }) as never;
    expect((await POST(req)).status).toBe(401);
    expect(settleInvoice).not.toHaveBeenCalled();
  });
});

// Review finding 8: during a signing-secret roll Stripe sends one v1 per secret.
describe("/api/stripe/webhook — signature header", () => {
  const event = { type: "checkout.session.completed", data: { object: session() } };

  it("accepts the event when any of several v1 signatures matches — not only the last", async () => {
    const res = await POST(signed(event, (t, v1) => `t=${t},v1=${v1},v1=${"0".repeat(64)}`));
    expect(res.status).toBe(200);
    expect(settleInvoice).toHaveBeenCalled();
  });

  it("accepts the matching signature wherever it sits, alongside a v0", async () => {
    const res = await POST(signed(event, (t, v1) => `t=${t},v1=${"ab".repeat(32)},v1=${v1},v0=${"cd".repeat(32)}`));
    expect(res.status).toBe(200);
  });

  it("rejects when none of them match, including a truncated one", async () => {
    const res = await POST(signed(event, (t, v1) => `t=${t},v1=${"0".repeat(64)},v1=${v1.slice(0, 32)}`));
    expect(res.status).toBe(401);
    expect(settleInvoice).not.toHaveBeenCalled();
  });

  it("rejects a v0-only header — v0 is never checked", async () => {
    const res = await POST(signed(event, (t, v1) => `t=${t},v0=${v1}`));
    expect(res.status).toBe(401);
  });
});
