import { afterEach, describe, expect, it, vi } from "vitest";
import { getPayments } from "@/lib/adapters/payments";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function withPromo(row: Record<string, unknown> | null) {
  const builder = queryBuilder(dbOk(row));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));
  return builder;
}

const PROMO = {
  id: "p1", months: 3, active: true, max_uses: null as number | null, used_count: 0, expires_at: null as string | null,
};

describe("createCheckout", () => {
  it("simulates a paid checkout when no promo code is given", async () => {
    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });
    expect(result).toEqual({ kind: "paid" });
  });

  it("redeems a valid, unused promo code and increments used_count", async () => {
    const builder = withPromo(PROMO);

    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme", promoCode: "smi-free" });

    expect(result).toEqual({ kind: "comped", months: 3 });
    expect(builder.update).toHaveBeenCalledWith({ used_count: 1 });
  });

  it("rejects an unknown code", async () => {
    withPromo(null);
    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme", promoCode: "nope" });
    expect(result).toEqual({ kind: "error", message: "Unknown promo code." });
  });

  it("rejects a deactivated code", async () => {
    withPromo({ ...PROMO, active: false });
    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme", promoCode: "smi-free" });
    expect(result).toEqual({ kind: "error", message: "Unknown promo code." });
  });

  it("rejects an expired code", async () => {
    withPromo({ ...PROMO, expires_at: "2020-01-01" });
    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme", promoCode: "smi-free" });
    expect(result).toEqual({ kind: "error", message: "Unknown promo code." });
  });

  it("rejects a code that has hit its max_uses", async () => {
    withPromo({ ...PROMO, max_uses: 5, used_count: 5 });
    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme", promoCode: "smi-free" });
    expect(result).toEqual({ kind: "error", message: "Unknown promo code." });
  });

  it("accepts a code just under its max_uses", async () => {
    const builder = withPromo({ ...PROMO, max_uses: 5, used_count: 4 });
    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme", promoCode: "smi-free" });
    expect(result).toEqual({ kind: "comped", months: 3 });
    expect(builder.update).toHaveBeenCalledWith({ used_count: 5 });
  });
});

describe("LocalStubPayments — production gate (GAPS C1)", () => {
  it("refuses a card checkout in production rather than silently comping it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });
    expect(result).toEqual({ kind: "error", message: expect.stringContaining("not configured") });
  });

  it("still redeems a promo code in production — a comp is real, not a simulated payment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const builder = withPromo(PROMO);
    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme", promoCode: "smi-free" });
    expect(result).toEqual({ kind: "comped", months: 3 });
    expect(builder.update).toHaveBeenCalledWith({ used_count: 1 });
  });
});

describe("cancelSubscription", () => {
  it("LocalStubPayments no-ops successfully — nothing real to cancel", async () => {
    const result = await getPayments().cancelSubscription("sub_1");
    expect(result).toEqual({ ok: true });
  });

  it("StripePayments schedules a cancel-at-period-end, not an immediate delete", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_PRICE_ID", "price_123");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await getPayments().cancelSubscription("sub_1");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/subscriptions/sub_1");
    expect(init?.method).toBe("POST");
    expect(new URLSearchParams(String(init?.body)).get("cancel_at_period_end")).toBe("true");
  });

  it("StripePayments reports Stripe's rejection", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_PRICE_ID", "price_123");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no such subscription", { status: 404 }));

    const result = await getPayments().cancelSubscription("sub_bad");

    expect(result).toEqual({ ok: false, reason: "stripe_rejected", error: expect.stringContaining("404") });
  });

  it("StripePayments passes Stripe's own message through when it sends one", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_PRICE_ID", "price_123");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ error: { type: "invalid_request_error", message: "No such subscription: 'sub_bad'" } }),
      { status: 404 },
    ));

    const result = await getPayments().cancelSubscription("sub_bad");

    expect(result).toEqual({ ok: false, reason: "stripe_rejected", error: "Stripe rejected the cancellation (404): No such subscription: 'sub_bad'" });
  });

  it("StripePayments reports a subscription Stripe has already closed as the period having ended", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_PRICE_ID", "price_123");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ error: { type: "invalid_request_error", message: "A canceled subscription can only update its cancellation_details and metadata." } }),
      { status: 400 },
    ));

    const result = await getPayments().cancelSubscription("sub_closed");

    expect(result).toEqual({ ok: false, reason: "period_ended", error: expect.stringContaining("canceled subscription") });
  });
});

describe("StripePayments", () => {
  // Hosted redirect: no publishable key, so the embedded modal (B1.7) is off.
  function liveEnv() {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_PRICE_ID", "price_123");
    vi.stubEnv("SITE_URL", "https://smi.example");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
    vi.stubEnv("MOCK_INTEGRATIONS", "");
  }

  describe("embedded Checkout (GAPS B1.7)", () => {
    function embeddedEnv() {
      liveEnv();
      vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_123");
    }
    // A fresh Response per call: a body can only be read once.
    const sessionReply = () =>
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(JSON.stringify({ id: "cs_1", client_secret: "cs_1_secret_x" }), { status: 200 }),
      );

    it("creates an embedded_page subscription session on the pinned API version", async () => {
      embeddedEnv();
      const fetchMock = sessionReply();

      const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });

      expect(result).toEqual({ kind: "embedded", clientSecret: "cs_1_secret_x" });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
      const headers = init?.headers as Record<string, string>;
      expect(headers["Stripe-Version"]).toBe("2026-03-25.dahlia");
      expect(headers["Idempotency-Key"]).toMatch(/^membership-checkout-m1-\d+$/);
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("ui_mode")).toBe("embedded_page");
      expect(body.get("mode")).toBe("subscription");
      expect(body.get("line_items[0][price]")).toBe("price_123");
      expect(body.get("client_reference_id")).toBe("m1");
      expect(body.get("metadata[kind]")).toBe("membership");
      expect(body.get("subscription_data[metadata][member_id]")).toBe("m1");
      expect(body.get("return_url")).toBe("https://smi.example/dashboard/pay?session_id={CHECKOUT_SESSION_ID}");
      // A redirect-mode field would make Stripe reject an embedded session.
      expect(body.has("success_url")).toBe(false);
      expect(body.has("cancel_url")).toBe(false);
    });

    it("sends the same idempotency key for a repeat within the minute", async () => {
      embeddedEnv();
      const fetchMock = sessionReply();
      vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

      await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });
      await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });

      const key = (i: number) => (fetchMock.mock.calls[i][1]?.headers as Record<string, string>)["Idempotency-Key"];
      expect(key(0)).toBe(key(1));
      expect(String(fetchMock.mock.calls[0][1]?.body)).toBe(String(fetchMock.mock.calls[1][1]?.body));
    });

    it("falls back to the hosted redirect on a Preview running the mocks", async () => {
      embeddedEnv();
      vi.stubEnv("MOCK_INTEGRATIONS", "1");
      vi.stubEnv("VERCEL_ENV", "preview");
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: "mock_cs_1", url: "https://smi.example/mock/stripe/checkout/mock_cs_1" }), { status: 200 }),
      );

      const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });

      expect(result.kind).toBe("redirect");
      expect(new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body)).has("ui_mode")).toBe(false);
    });

    it("reports a 200 with no client secret as an error", async () => {
      embeddedEnv();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "cs_1" }), { status: 200 }));

      const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });

      expect(result).toEqual({ kind: "error", message: "Stripe did not return a checkout session." });
    });
  });

  it("posts a form-urlencoded checkout session and returns the redirect url", async () => {
    liveEnv();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }), { status: 200 }),
    );

    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });

    expect(result).toEqual({ kind: "redirect", url: "https://checkout.stripe.com/cs_1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_123");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("client_reference_id")).toBe("m1");
    expect(body.get("subscription_data[metadata][member_id]")).toBe("m1");
    expect(body.get("success_url")).toBe("https://smi.example/dashboard?submitted=paid");
    expect(body.get("cancel_url")).toBe("https://smi.example/dashboard/pay");
  });

  it("still redeems a promo code without calling Stripe", async () => {
    liveEnv();
    const builder = withPromo(PROMO);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme", promoCode: "smi-free" });

    expect(result).toEqual({ kind: "comped", months: 3 });
    expect(builder.update).toHaveBeenCalledWith({ used_count: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a 200 with no checkout URL as an error rather than redirecting nowhere", async () => {
    liveEnv();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_1" }), { status: 200 }),
    );

    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });

    expect(result).toEqual({ kind: "error", message: "Stripe did not return a checkout URL." });
  });

  it("reports Stripe's rejection as a checkout error", async () => {
    liveEnv();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("card declined", { status: 402 }));

    const result = await getPayments().createCheckout({ memberId: "m1", email: "a@b.com", companyName: "Acme" });

    expect(result).toEqual({ kind: "error", message: expect.stringContaining("402") });
  });
});

describe("paymentsAreLive", () => {
  it("is false without STRIPE_SECRET_KEY", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { paymentsAreLive } = await import("@/lib/adapters/payments");
    expect(paymentsAreLive()).toBe(false);
  });

  it("is true once STRIPE_SECRET_KEY is set", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    const { paymentsAreLive } = await import("@/lib/adapters/payments");
    expect(paymentsAreLive()).toBe(true);
  });
});
