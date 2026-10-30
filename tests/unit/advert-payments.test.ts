import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  holdsForPayment, invoiceAdvertising, invoiceCheckoutSecret, settleInvoice, voidBundleInvoiceIfAbandoned, voidInvoices,
} from "@/lib/advert-payments";
import {
  advertPaymentsMode, createInvoiceCheckout, expireCheckoutSession, retrieveCheckoutSession, STRIPE_API_VERSION,
} from "@/lib/adapters/advert-checkout";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { enqueue, runQueuedJobSoon } = vi.hoisted(() => ({ enqueue: vi.fn(async () => {}), runQueuedJobSoon: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ enqueue, runQueuedJobSoon }));

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
  vi.stubEnv("MOCK_INTEGRATIONS", "");
});

afterEach(() => {
  resetDbServerMocks();
  enqueue.mockReset().mockResolvedValue(undefined);
  runQueuedJobSoon.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>, rpc?: (...args: unknown[]) => unknown) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  const client = mockDb({ from, ...(rpc ? { rpc } : {}) });
  vi.mocked(serviceDb).mockReturnValue(asDb(client));
  return Object.assign(from, { rpc: client.rpc });
}

/** Stripe's REST API, routed by method + path, recording each call. */
function stripe(routes: Record<string, (init: RequestInit) => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input));
    const key = `${init.method ?? "GET"} ${url.pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected Stripe call: ${key}`);
    return route(init);
  });
}

describe("advertPaymentsMode", () => {
  it("is real Stripe only with both keys", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    expect(advertPaymentsMode()).toBe("simulated"); // no publishable key, not production
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_1");
    expect(advertPaymentsMode()).toBe("stripe");
  });

  it("is off in production with only one of the two keys — nothing is held that couldn't be paid", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_1");
    expect(advertPaymentsMode()).toBe("off");
    expect(holdsForPayment(65000)).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_live_1");
    expect(advertPaymentsMode()).toBe("off");
  });

  it("is off in production without keys, so nothing is ever held there", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(advertPaymentsMode()).toBe("off");
    expect(holdsForPayment(65000)).toBe(false);
  });

  it("simulates on a mock-integrations Preview even with keys — Stripe.js can't run against the mocks", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_1");
    vi.stubEnv("MOCK_INTEGRATIONS", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(advertPaymentsMode()).toBe("simulated");
  });
});

describe("holdsForPayment", () => {
  it("holds a priced run, never an unpriced or free one", () => {
    expect(holdsForPayment(1)).toBe(true);
    expect(holdsForPayment(0)).toBe(false);
    expect(holdsForPayment(null)).toBe(false);
    expect(holdsForPayment(undefined)).toBe(false);
  });
});

describe("invoiceAdvertising", () => {
  it("raises a linked invoice and emails the member a pay link", async () => {
    const invoices = queryBuilder((): DbResult => (callsOf(invoices.insert).length ? dbOk({ id: "inv1" }) : dbOk([])));
    db({ invoices: () => invoices });

    const raised = await invoiceAdvertising("m1", 65000, { advert_booking_id: "b1", description: "Advert: x" });

    expect(raised).toEqual({ ok: true, created: true, invoice: { id: "inv1", number: expect.stringMatching(/^SMI-ADV-/) } });
    expect(invoices.insert).toHaveBeenCalledWith(expect.objectContaining({ advert_booking_id: "b1", description: "Advert: x", status: "issued" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({
      member_id: "m1", kind: "advert_payment_due", invoice_id: "inv1", amount: "£650.00", booking_id: "b1",
    }));
  });

  // Review finding 4/5: a double-clicked Approve used to raise two payable
  // invoices and send two pay links.
  it("hands back the item's existing invoice and sends no second pay link", async () => {
    const invoices = queryBuilder(dbOk([{ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 65000, status: "issued" }]));
    db({ invoices: () => invoices });

    const again = await invoiceAdvertising("m1", 65000, { advert_booking_id: "b1" });

    expect(again).toEqual({ ok: true, created: false, invoice: { id: "inv1", number: "SMI-ADV-1" } });
    expect(invoices.insert).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("raises nothing for an unpriced item", async () => {
    const from = db({});
    expect(await invoiceAdvertising("m1", null, {})).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("still invoices with payments off, but sends no pay link — there's nowhere to pay", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const invoices = queryBuilder((): DbResult => (callsOf(invoices.insert).length ? dbOk({ id: "inv1" }) : dbOk([])));
    db({ invoices: () => invoices });

    await invoiceAdvertising("m1", 65000, { advert_booking_id: "b1" });

    expect(invoices.insert).toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("settleInvoice", () => {
  const settled = { outcome: "settled", member_id: "m1", job_id: "job1", open_session_id: null };

  it("settles through settle_invoice() — flip, releases and receipt in one transaction — and kicks the receipt", async () => {
    const rpc = vi.fn(async () => dbOk(settled));
    db({}, rpc);

    expect(await settleInvoice("inv1", { sessionId: "cs_test_1", paid: { amountPennies: 65000, currency: "gbp" } }))
      .toEqual({ settled: true, memberId: "m1" });

    expect(rpc).toHaveBeenCalledWith("settle_invoice", {
      p_invoice_id: "inv1", p_session_id: "cs_test_1", p_paid_amount: 65000, p_paid_currency: "gbp",
    });
    expect(runQueuedJobSoon).toHaveBeenCalledWith("job1");
    // the receipt is queued inside the transaction, never by a second call that could fail on its own
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("sends no amount check for a payment Stripe didn't take (Mark paid, the simulator)", async () => {
    const rpc = vi.fn(async () => dbOk(settled));
    db({}, rpc);
    await settleInvoice("inv1");
    expect(rpc).toHaveBeenCalledWith("settle_invoice", { p_invoice_id: "inv1" });
  });

  it("refuses to settle on an amount Stripe didn't report — a missing amount is a mismatch, not a pass", async () => {
    const rpc = vi.fn(async () => dbOk({ outcome: "amount_mismatch", member_id: "m1" }));
    db({}, rpc);
    expect(await settleInvoice("inv1", { sessionId: "cs_1", paid: { amountPennies: null, currency: null } }))
      .toEqual({ settled: false, reason: "amount_mismatch", memberId: "m1" });
    expect(rpc).toHaveBeenCalledWith("settle_invoice", expect.objectContaining({ p_paid_amount: -1, p_paid_currency: "" }));
  });

  it("says who paid it when it was already paid — so the webhook can tell a replay from a double payment", async () => {
    db({}, vi.fn(async () => dbOk({ outcome: "paid", member_id: "m1", paid_session_id: "cs_first" })));
    expect(await settleInvoice("inv1", { sessionId: "cs_second" }))
      .toEqual({ settled: false, reason: "paid", paidSessionId: "cs_first", memberId: "m1" });
    expect(runQueuedJobSoon).not.toHaveBeenCalled();
  });

  it("reports a void invoice as not settled", async () => {
    db({}, vi.fn(async () => dbOk({ outcome: "void", member_id: "m1", paid_session_id: null })));
    expect(await settleInvoice("inv1")).toEqual({ settled: false, reason: "void", memberId: "m1" });
  });

  // Review finding 1: a DB error used to read as "already paid", so the
  // webhook answered 200 and Stripe never retried.
  it("throws on a database error instead of reporting 'not settled'", async () => {
    db({}, vi.fn(async () => dbError("connection reset")));
    await expect(settleInvoice("inv1", { sessionId: "cs_1" })).rejects.toThrow(/connection reset/);
  });

  it("expires a second session still open on the invoice it just settled", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    db({}, vi.fn(async () => dbOk({ ...settled, open_session_id: "cs_other" })));
    const fetchSpy = stripe({ "POST /v1/checkout/sessions/cs_other/expire": () => new Response("{}") });

    await settleInvoice("inv1", { sessionId: "cs_paid" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("doesn't try to expire the session that paid", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    db({}, vi.fn(async () => dbOk({ ...settled, open_session_id: "cs_paid" })));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await settleInvoice("inv1", { sessionId: "cs_paid" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("voidInvoices", () => {
  beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1"));

  it("expires the open Checkout Session, then voids the invoice", async () => {
    const invoices = queryBuilder((): DbResult => (callsOf(invoices.update).length
      ? dbOk([{ id: "inv1" }])
      : dbOk([{ id: "inv1", checkout_session_id: "cs_open" }])));
    db({ invoices: () => invoices });
    const fetchSpy = stripe({ "POST /v1/checkout/sessions/cs_open/expire": () => new Response("{}") });

    expect(await voidInvoices({ advert_booking_id: "b1" })).toEqual({ ok: true, voided: ["inv1"], paying: [] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(invoices.eq).toHaveBeenCalledWith("advert_booking_id", "b1");
    expect(invoices.update).toHaveBeenCalledWith({ status: "void", checkout_session_id: null, checkout_expires_at: null });
    expect(invoices.eq).toHaveBeenCalledWith("status", "issued");
  });

  it("leaves an invoice issued when its session has already completed — the member is paying for it", async () => {
    const invoices = queryBuilder(dbOk([{ id: "inv1", checkout_session_id: "cs_done" }]));
    db({ invoices: () => invoices });
    stripe({
      "POST /v1/checkout/sessions/cs_done/expire": () => new Response("not open", { status: 400 }),
      "GET /v1/checkout/sessions/cs_done": () => new Response(JSON.stringify({ status: "complete", payment_status: "paid" })),
    });

    expect(await voidInvoices({ placement_id: "pl1" })).toEqual({ ok: true, voided: [], paying: ["inv1"] });
    expect(invoices.update).not.toHaveBeenCalled();
  });

  it("still voids when the session had already expired", async () => {
    const invoices = queryBuilder((): DbResult => (callsOf(invoices.update).length
      ? dbOk([{ id: "inv1" }])
      : dbOk([{ id: "inv1", checkout_session_id: "cs_old" }])));
    db({ invoices: () => invoices });
    stripe({
      "POST /v1/checkout/sessions/cs_old/expire": () => new Response("expired", { status: 400 }),
      "GET /v1/checkout/sessions/cs_old": () => new Response(JSON.stringify({ status: "expired" })),
    });

    expect(await voidInvoices({ bundle_id: "bd1" })).toEqual({ ok: true, voided: ["inv1"], paying: [] });
  });

  it("refuses anything but exactly one link", async () => {
    const from = db({});
    expect(await voidInvoices({})).toEqual({ ok: false, error: expect.stringContaining("exactly one") });
    expect(await voidInvoices({ advert_booking_id: "b1", bundle_id: "bd1" })).toEqual({ ok: false, error: expect.stringContaining("exactly one") });
    expect(from).not.toHaveBeenCalled();
  });

  it("reports a database error rather than claiming nothing needed voiding", async () => {
    db({ invoices: () => queryBuilder(dbError("timeout")) });
    expect(await voidInvoices({ advert_booking_id: "b1" })).toEqual({ ok: false, error: expect.stringContaining("timeout") });
  });
});

describe("voidBundleInvoiceIfAbandoned", () => {
  // Review finding 6: the invoice stayed payable after Jas called off every part.
  it("voids the bundle's invoice once no part is awaiting payment, scheduled or live", async () => {
    const bookings = queryBuilder(dbOk(null, 0));
    const invoices = queryBuilder((): DbResult => (callsOf(invoices.update).length ? dbOk([{ id: "inv1" }]) : dbOk([{ id: "inv1", checkout_session_id: null }])));
    db({ advert_bookings: () => bookings, invoices: () => invoices });

    expect(await voidBundleInvoiceIfAbandoned("bd1")).toEqual({ ok: true, voided: true, paying: false });

    expect(bookings.eq).toHaveBeenCalledWith("bundle_id", "bd1");
    expect(bookings.in).toHaveBeenCalledWith("status", ["awaiting_payment", "scheduled", "live"]);
    expect(invoices.eq).toHaveBeenCalledWith("bundle_id", "bd1");
    expect(invoices.update).toHaveBeenCalled();
  });

  it("leaves it alone while any part is still owed for", async () => {
    const from = db({ advert_bookings: () => queryBuilder(dbOk(null, 1)) });
    expect(await voidBundleInvoiceIfAbandoned("bd1")).toEqual({ ok: true, voided: false, paying: false });
    expect(from).not.toHaveBeenCalledWith("invoices");
  });
});

describe("invoiceCheckoutSecret", () => {
  beforeEach(() => vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1"));
  const inFuture = () => new Date(Date.now() + 30 * 60_000).toISOString();
  const invoice = { id: "inv1", number: "SMI-ADV-1", amount_pennies: 65000, description: "Advert: x", checkout_session_id: null, checkout_expires_at: null };
  const member = { memberId: "m1", email: "a@b.example" };
  const RETURN = "https://smi.example/dashboard/pay/invoice/inv1?session_id={CHECKOUT_SESSION_ID}";

  // Review finding 2: every mount opened a new payable session.
  it("reuses the session already open for the invoice instead of opening a second", async () => {
    db({});
    const fetchSpy = stripe({
      "GET /v1/checkout/sessions/cs_open": () => new Response(JSON.stringify({ status: "open", client_secret: "cs_open_secret", metadata: { invoice_id: "inv1" } })),
    });

    expect(await invoiceCheckoutSecret({ ...invoice, checkout_session_id: "cs_open", checkout_expires_at: inFuture() }, member, RETURN))
      .toEqual({ ok: true, clientSecret: "cs_open_secret" });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no POST — nothing created
  });

  it("opens and remembers a session when none is open, swapping only from the state it read", async () => {
    const invoices = queryBuilder(dbOk([{ id: "inv1" }]));
    db({ invoices: () => invoices });
    stripe({ "POST /v1/checkout/sessions": () => new Response(JSON.stringify({ id: "cs_new", client_secret: "cs_new_secret" })) });

    expect(await invoiceCheckoutSecret(invoice, member, RETURN)).toEqual({ ok: true, clientSecret: "cs_new_secret" });

    expect(invoices.update).toHaveBeenCalledWith({ checkout_session_id: "cs_new", checkout_expires_at: expect.any(String) });
    expect(invoices.is).toHaveBeenCalledWith("checkout_session_id", null);
    expect(invoices.eq).toHaveBeenCalledWith("status", "issued");
  });

  it("replaces an expired session, keyed on the one it replaces", async () => {
    const invoices = queryBuilder(dbOk([{ id: "inv1" }]));
    db({ invoices: () => invoices });
    const fetchSpy = stripe({
      "GET /v1/checkout/sessions/cs_old": () => new Response(JSON.stringify({ status: "expired", metadata: { invoice_id: "inv1" } })),
      "POST /v1/checkout/sessions": () => new Response(JSON.stringify({ id: "cs_new", client_secret: "cs_new_secret" })),
    });

    expect(await invoiceCheckoutSecret({ ...invoice, checkout_session_id: "cs_old", checkout_expires_at: inFuture() }, member, RETURN))
      .toEqual({ ok: true, clientSecret: "cs_new_secret" });
    const create = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect((create[1]!.headers as Record<string, string>)["Idempotency-Key"]).toContain("-cs_old-");
    expect(invoices.eq).toHaveBeenCalledWith("checkout_session_id", "cs_old");
  });

  it("losing the race to another tab expires its own session and hands out the winner's", async () => {
    const invoices = queryBuilder((): DbResult => (callsOf(invoices.update).length && callsOf(invoices.maybeSingle).length
      ? dbOk({ status: "issued", checkout_session_id: "cs_winner", checkout_expires_at: inFuture() })
      : dbOk([])));
    db({ invoices: () => invoices });
    const fetchSpy = stripe({
      "POST /v1/checkout/sessions": () => new Response(JSON.stringify({ id: "cs_loser", client_secret: "cs_loser_secret" })),
      "POST /v1/checkout/sessions/cs_loser/expire": () => new Response("{}"),
      "GET /v1/checkout/sessions/cs_winner": () => new Response(JSON.stringify({ status: "open", client_secret: "cs_winner_secret", metadata: { invoice_id: "inv1" } })),
    });

    expect(await invoiceCheckoutSecret(invoice, member, RETURN)).toEqual({ ok: true, clientSecret: "cs_winner_secret" });
    expect(fetchSpy.mock.calls.map(([u]) => new URL(String(u)).pathname)).toContain("/v1/checkout/sessions/cs_loser/expire");
  });

  it("says so when the open session has just been paid", async () => {
    db({});
    stripe({ "GET /v1/checkout/sessions/cs_open": () => new Response(JSON.stringify({ status: "complete", metadata: { invoice_id: "inv1" } })) });
    expect(await invoiceCheckoutSecret({ ...invoice, checkout_session_id: "cs_open", checkout_expires_at: inFuture() }, member, RETURN))
      .toEqual({ ok: false, error: expect.any(String), alreadyPaid: true });
  });
});

describe("createInvoiceCheckout", () => {
  it("opens a pinned-version, embedded, one-off session for exactly the invoice", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "cs_1", client_secret: "cs_1_secret" })));

    const result = await createInvoiceCheckout({
      invoiceId: "inv1", invoiceNumber: "SMI-ADV-1", memberId: "m1", email: "a@b.example",
      description: "Advert: x", amountPennies: 65000, returnUrl: "https://smi.example/dashboard/pay/invoice/inv1?session_id={CHECKOUT_SESSION_ID}",
      replacesSessionId: null,
    });

    expect(result).toEqual({ ok: true, clientSecret: "cs_1_secret", sessionId: "cs_1", expiresAt: expect.any(String) });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const headers = init.headers as Record<string, string>;
    expect(headers["Stripe-Version"]).toBe(STRIPE_API_VERSION);
    expect(headers.Authorization).toBe("Bearer sk_test_1");
    const body = init.body as URLSearchParams;
    expect(body.get("mode")).toBe("payment");
    expect(body.get("ui_mode")).toBe("embedded_page");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("65000");
    expect(body.get("line_items[0][price_data][currency]")).toBe("gbp");
    // the marker the webhook branches on — without it this would read as membership
    expect(body.get("metadata[kind]")).toBe("advert_invoice");
    expect(body.get("metadata[invoice_id]")).toBe("inv1");
    expect(body.get("return_url")).toContain("{CHECKOUT_SESSION_ID}");
    expect(body.has("success_url")).toBe(false); // not allowed with embedded_page
    // short-lived, and in step with the idempotency key so a double click repeats the same request
    const minute = Number(headers["Idempotency-Key"].split("-").pop());
    expect(Number(body.get("expires_at"))).toBe((minute + 60) * 60);
    expect(headers["Idempotency-Key"]).toBe(`invoice-checkout-inv1-first-${minute}`);
    if (!result.ok) throw new Error("unreachable");
    expect(Date.parse(result.expiresAt) / 1000).toBe((minute + 60) * 60);
  });

  it("reports Stripe's refusal rather than throwing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 400 }));
    const result = await createInvoiceCheckout({
      invoiceId: "inv1", invoiceNumber: "SMI-ADV-1", memberId: "m1", email: null, description: "x", amountPennies: 1, returnUrl: "https://x.example",
      replacesSessionId: null,
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("400") });
  });
});

describe("retrieveCheckoutSession", () => {
  it("refuses an id that isn't a Checkout Session's, without calling Stripe", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await retrieveCheckoutSession("../v1/customers")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads back status and the invoice it was for", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      status: "complete", payment_status: "paid", metadata: { kind: "advert_invoice", invoice_id: "inv1" },
      client_secret: "cs_test_1_secret", amount_total: 65000, currency: "gbp",
    })));
    expect(await retrieveCheckoutSession("cs_test_1")).toEqual({
      status: "complete", paymentStatus: "paid", invoiceId: "inv1", kind: "advert_invoice",
      clientSecret: "cs_test_1_secret", amountTotal: 65000, currency: "gbp",
      clientReferenceId: null, memberId: null, subscriptionId: null, customerId: null,
    });
  });

  // GAPS B1.7: the membership return page checks who a session was for.
  it("reads back who a membership session was for and what it created", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      status: "complete", payment_status: "paid", client_reference_id: "m1",
      metadata: { kind: "membership", member_id: "m1" }, subscription: "sub_1", customer: "cus_1",
    })));
    expect(await retrieveCheckoutSession("cs_test_2")).toMatchObject({
      kind: "membership", clientReferenceId: "m1", memberId: "m1", subscriptionId: "sub_1", customerId: "cus_1",
    });
  });
});

describe("expireCheckoutSession", () => {
  it("POSTs to the session's expire endpoint on the pinned version", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    expect(await expireCheckoutSession("cs_test_1")).toEqual({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_1/expire");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Stripe-Version"]).toBe(STRIPE_API_VERSION);
  });

  it("refuses an id that isn't a session's, without calling Stripe", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await expireCheckoutSession("cs_1/../../customers")).toEqual({ ok: false, status: null, error: expect.any(String) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function callsOf(mockFn: unknown): unknown[][] {
  return (mockFn as ReturnType<typeof vi.fn>).mock.calls;
}
