/**
 * Payments adapter (TECH-DECISIONS #16): Stripe in production, stub locally.
 * Constraint: existing Stripe subscriptions are never touched; members never
 * interact with Stripe directly (invoices served via the member area).
 */

import { serviceDb } from "../db/server";
import { siteUrl } from "../site-url";
import { mockBaseUrl } from "./mock-base-url";

export type CheckoutRequest = { memberId: string; email: string; companyName: string; promoCode?: string };
export type CheckoutResult =
  | { kind: "redirect"; url: string }   // Stripe-hosted checkout (production)
  | { kind: "paid" }                    // payment settled (stub simulates success)
  | { kind: "comped"; months: number }  // valid promo code
  | { kind: "error"; message: string };

export type CancelResult = { ok: true } | { ok: false; error: string };

export interface Payments {
  /** Create a £40/mo subscription checkout; promo codes (managed at /console/promo-codes) apply here. */
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /**
   * GAPS B1.5 — cancel at the current period end, not immediately: a member
   * who has already paid for this month keeps access through it, the same
   * way a failed-payment grace period doesn't cut someone off mid-window.
   * `subscriptionId` must be one this app itself wrote to `members.stripe_
   * subscription_id` — B1.6 ("existing Stripe subscriptions must never be
   * touched") means a cancel action can never derive/guess an id another way.
   */
  cancelSubscription(subscriptionId: string): Promise<CancelResult>;
}

/**
 * Redeem a promo code (GAPS A4.11) — shared by both payment paths, since the
 * public join flow is the only caller of createCheckout with a code at all.
 * Read-then-write, not an atomic increment: promo redemption is low-volume
 * enough that the same app-level pragmatism the featured-member booking cap
 * (A2.2) already accepts applies here too.
 */
async function redeemPromoCode(rawCode: string): Promise<CheckoutResult> {
  const code = rawCode.trim().toUpperCase();
  const db = serviceDb();
  const { data: promo } = await db.from("promo_codes")
    .select("id, months, active, max_uses, used_count, expires_at")
    .eq("code", code).maybeSingle();
  const today = new Date().toISOString().slice(0, 10);
  const valid = promo && promo.active
    && (!promo.expires_at || promo.expires_at >= today)
    && (promo.max_uses === null || promo.used_count < promo.max_uses);
  if (!promo || !valid) return { kind: "error", message: "Unknown promo code." };
  await db.from("promo_codes").update({ used_count: promo.used_count + 1 }).eq("id", promo.id);
  return { kind: "comped", months: promo.months };
}

class LocalStubPayments implements Payments {
  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (req.promoCode) return redeemPromoCode(req.promoCode);
    if (process.env.NODE_ENV === "production") {
      // STRIPE_SECRET_KEY is unset — refuse rather than silently comp a real
      // signup with no money moved (GAPS C1). Promo codes above are unaffected:
      // a comp is a legitimate free membership, not a simulated card payment.
      return { kind: "error", message: "Payments are not configured. Please contact SMI to complete your membership." };
    }
    return { kind: "paid" }; // local/preview dev: card payment simulated as successful
  }

  async cancelSubscription(): Promise<CancelResult> {
    return { ok: true }; // nothing real to cancel — the member row itself is updated by the caller
  }
}

/**
 * Raw `fetch` against Stripe's REST API (form-urlencoded, like every other
 * Stripe endpoint) — no `stripe` package, matching every other adapter in
 * this directory. `baseUrl` is `https://api.stripe.com` in production, or a
 * `/api/mock/stripe` route on this same deployment when `mockBaseUrl()` is
 * set (Preview only — see `./mock-base-url.ts`).
 */
class StripePayments implements Payments {
  constructor(
    private secretKey: string,
    private baseUrl: string,
    private priceId: string,
    private successUrl: string,
    private cancelUrl: string,
  ) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (req.promoCode) return redeemPromoCode(req.promoCode);

    const body = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": this.priceId,
      "line_items[0][quantity]": "1",
      customer_email: req.email,
      client_reference_id: req.memberId,
      // Copied onto the created Subscription, since a later invoice.payment_failed
      // event carries the subscription, not the checkout session — see the
      // webhook route's fallback lookup.
      "subscription_data[metadata][member_id]": req.memberId,
      success_url: this.successUrl,
      cancel_url: this.cancelUrl,
    });
    const res = await fetch(`${this.baseUrl}/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { kind: "error", message: `Stripe rejected the checkout (${res.status}): ${detail.slice(0, 300)}` };
    }
    const session = (await res.json()) as { url?: string };
    if (!session.url) return { kind: "error", message: "Stripe did not return a checkout URL." };
    return { kind: "redirect", url: session.url };
  }

  /**
   * `cancel_at_period_end=true` on the subscription, not `DELETE` — Stripe's
   * documented distinction between "stop renewing" and "cancel now". The
   * actual state transition happens later, when Stripe's own
   * `customer.subscription.deleted` event fires at the period's real end
   * (see the webhook route) — this call only schedules it.
   */
  async cancelSubscription(subscriptionId: string): Promise<CancelResult> {
    const res = await fetch(`${this.baseUrl}/v1/subscriptions/${subscriptionId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ cancel_at_period_end: "true" }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Stripe rejected the cancellation (${res.status}): ${detail.slice(0, 300)}` };
    }
    return { ok: true };
  }
}

export function getPayments(): Payments {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (key) {
    const base = siteUrl();
    return new StripePayments(
      key,
      mockBaseUrl() ?? "https://api.stripe.com",
      process.env.STRIPE_PRICE_ID!,
      `${base}/dashboard?submitted=paid`,
      `${base}/dashboard/pay`,
    );
  }
  return new LocalStubPayments();
}

/**
 * Whether a `{ kind: "paid" }` result means money actually moved.
 *
 * True once `getPayments()` actually returns the Stripe adapter (GAPS B1.2,
 * C5) — before that the stub stamps `paid_at` and raises a £40 invoice with
 * nothing charged, and anything that would tell a member we received their
 * payment must check this first: emailing a receipt for a simulated payment
 * turns an internal stub into a false record in someone's inbox.
 */
export function paymentsAreLive(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}
