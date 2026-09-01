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

    expect(result).toEqual({ ok: false, error: expect.stringContaining("404") });
  });
});

describe("StripePayments", () => {
  function liveEnv() {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_PRICE_ID", "price_123");
    vi.stubEnv("SITE_URL", "https://smi.example");
  }

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
