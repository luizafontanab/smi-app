import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The advert-invoice branch of /api/stripe/webhook (6 Oct), mocked rather
 * than run against the database like stripe-webhook.test.ts: what matters
 * here is routing — an advert payment must settle its invoice and must NEVER
 * reach the membership path, which would stamp the £40 join fee as paid.
 */
const { settleInvoice, applyPaymentResult } = vi.hoisted(() => ({
  settleInvoice: vi.fn(async () => ({ settled: true, memberId: "m1" })),
  applyPaymentResult: vi.fn(async () => {}),
}));
vi.mock("@/lib/advert-payments", () => ({ settleInvoice }));
vi.mock("@/lib/membership", () => ({ applyPaymentResult, applyPaymentFailure: vi.fn(), applySubscriptionEnded: vi.fn() }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

import { POST } from "@/app/api/stripe/webhook/route";

const SECRET = "whsec_unit";

function signed(event: unknown) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000).toString();
  const v1 = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${t},v1=${v1}` },
    body,
  }) as never;
}

const session = (extra: Record<string, unknown> = {}) => ({
  id: "cs_test_1",
  client_reference_id: "m1",
  payment_status: "paid",
  metadata: { kind: "advert_invoice", invoice_id: "inv1", member_id: "m1" },
  ...extra,
});

beforeEach(() => vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET));
afterEach(() => {
  vi.unstubAllEnvs();
  settleInvoice.mockClear();
  applyPaymentResult.mockClear();
});

describe("/api/stripe/webhook — advert invoices", () => {
  it("settles the invoice a paid advert session was for, and leaves membership alone", async () => {
    const res = await POST(signed({ type: "checkout.session.completed", data: { object: session() } }));
    expect(res.status).toBe(200);
    expect(settleInvoice).toHaveBeenCalledWith("inv1", { sessionId: "cs_test_1" });
    expect(applyPaymentResult).not.toHaveBeenCalled();
  });

  it("waits on a session that completed unpaid (a delayed bank payment), then settles on async success", async () => {
    await POST(signed({ type: "checkout.session.completed", data: { object: session({ payment_status: "unpaid" }) } }));
    expect(settleInvoice).not.toHaveBeenCalled();

    await POST(signed({ type: "checkout.session.async_payment_succeeded", data: { object: session() } }));
    expect(settleInvoice).toHaveBeenCalledWith("inv1", { sessionId: "cs_test_1" });
    expect(applyPaymentResult).not.toHaveBeenCalled();
  });

  it("still routes a membership checkout to the membership path", async () => {
    await POST(signed({ type: "checkout.session.completed", data: { object: { client_reference_id: "m1" } } }));
    expect(applyPaymentResult).toHaveBeenCalledWith("m1", { kind: "paid" });
    expect(settleInvoice).not.toHaveBeenCalled();
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
