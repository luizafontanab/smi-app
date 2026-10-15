import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdsForPayment, invoiceAdvertising, settleInvoice } from "@/lib/advert-payments";
import { advertPaymentsMode, createInvoiceCheckout, retrieveCheckoutSession, STRIPE_API_VERSION } from "@/lib/adapters/advert-checkout";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue }));

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
  vi.stubEnv("MOCK_INTEGRATIONS", "");
});

afterEach(() => {
  resetDbServerMocks();
  enqueue.mockReset().mockResolvedValue(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("advertPaymentsMode", () => {
  it("is real Stripe only with both keys", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    expect(advertPaymentsMode()).toBe("simulated"); // no publishable key, not production
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_1");
    expect(advertPaymentsMode()).toBe("stripe");
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
    const invoices = queryBuilder(dbOk({ id: "inv1" }));
    db({ invoices: () => invoices });

    const raised = await invoiceAdvertising("m1", 65000, { advert_booking_id: "b1", description: "Advert: x" });

    expect(raised).toEqual({ id: "inv1", number: expect.stringMatching(/^SMI-ADV-/) });
    expect(invoices.insert).toHaveBeenCalledWith(expect.objectContaining({ advert_booking_id: "b1", description: "Advert: x", status: "issued" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({
      member_id: "m1", kind: "advert_payment_due", invoice_id: "inv1", amount: "£650.00", booking_id: "b1",
    }));
  });

  it("raises nothing for an unpriced item", async () => {
    const from = db({});
    expect(await invoiceAdvertising("m1", null, {})).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("still invoices with payments off, but sends no pay link — there's nowhere to pay", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const invoices = queryBuilder(dbOk({ id: "inv1" }));
    db({ invoices: () => invoices });

    await invoiceAdvertising("m1", 65000, { advert_booking_id: "b1" });

    expect(invoices.insert).toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("settleInvoice", () => {
  const paid = { id: "inv1", member_id: "m1", number: "SMI-ADV-1", amount_pennies: 65000, advert_booking_id: null, bundle_id: null, placement_id: null };

  it("marks it paid and releases the held booking it was for", async () => {
    const invoices = queryBuilder(dbOk([{ ...paid, advert_booking_id: "b1" }]));
    const bookings = queryBuilder(dbOk(null));
    db({ invoices: () => invoices, advert_bookings: () => bookings });

    expect(await settleInvoice("inv1", { sessionId: "cs_test_1" })).toEqual({ settled: true, memberId: "m1" });

    expect(invoices.update).toHaveBeenCalledWith(expect.objectContaining({ status: "paid", paid_at: expect.any(String), stripe_session_id: "cs_test_1" }));
    // the conditional update is the lock: only an issued invoice can be won
    expect(invoices.eq).toHaveBeenCalledWith("status", "issued");
    expect(bookings.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(bookings.eq).toHaveBeenCalledWith("id", "b1");
    expect(bookings.eq).toHaveBeenCalledWith("status", "awaiting_payment");
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_received", invoice_id: "inv1", booking_id: "b1" }));
  });

  it("releases every held part of a bundle", async () => {
    const bookings = queryBuilder(dbOk(null));
    db({ invoices: () => queryBuilder(dbOk([{ ...paid, bundle_id: "bd1" }])), advert_bookings: () => bookings });

    await settleInvoice("inv1");

    expect(bookings.eq).toHaveBeenCalledWith("bundle_id", "bd1");
  });

  it("puts a held placement on the site", async () => {
    const placements = queryBuilder(dbOk(null));
    db({ invoices: () => queryBuilder(dbOk([{ ...paid, placement_id: "pl1" }])), placements: () => placements });

    await settleInvoice("inv1");

    expect(placements.update).toHaveBeenCalledWith({ awaiting_payment: false });
    expect(placements.eq).toHaveBeenCalledWith("id", "pl1");
  });

  it("does nothing the second time — a webhook replay and the return page can both call it", async () => {
    const from = db({ invoices: () => queryBuilder(dbOk([])) });

    expect(await settleInvoice("inv1")).toEqual({ settled: false });

    expect(from).not.toHaveBeenCalledWith("advert_bookings");
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("createInvoiceCheckout", () => {
  it("opens a pinned-version, embedded, one-off session for exactly the invoice", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "cs_1", client_secret: "cs_1_secret" })));

    const result = await createInvoiceCheckout({
      invoiceId: "inv1", invoiceNumber: "SMI-ADV-1", memberId: "m1", email: "a@b.example",
      description: "Advert: x", amountPennies: 65000, returnUrl: "https://smi.example/dashboard/pay/invoice/inv1?session_id={CHECKOUT_SESSION_ID}",
    });

    expect(result).toEqual({ ok: true, clientSecret: "cs_1_secret", sessionId: "cs_1" });
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
  });

  it("reports Stripe's refusal rather than throwing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 400 }));
    const result = await createInvoiceCheckout({
      invoiceId: "inv1", invoiceNumber: "SMI-ADV-1", memberId: "m1", email: null, description: "x", amountPennies: 1, returnUrl: "https://x.example",
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
    })));
    expect(await retrieveCheckoutSession("cs_test_1")).toEqual({ status: "complete", paymentStatus: "paid", invoiceId: "inv1", kind: "advert_invoice" });
  });
});
