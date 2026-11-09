/**
 * Payments adapter: Stripe in production, stub locally. (This used to cite
 * TECH-DECISIONS #16 — that number is Lead generation; Stripe has no numbered
 * row in that table.)
 * Constraint: existing Stripe subscriptions are never touched. Members enter
 * card details only in Stripe's own embedded form, in a modal on
 * /dashboard/pay (GAPS B1.7); invoices are served from the member area.
 */

import { serviceDb } from "../db/server";
import { siteUrl } from "../site-url";
import { STRIPE_API_VERSION, stripePublishableKey } from "./advert-checkout";
import { mockBaseUrl } from "./mock-base-url";

/** Marks a Checkout Session as the £40 membership, so the pay page's return check can tell it from an advert's. */
export const MEMBERSHIP_CHECKOUT_KIND = "membership";

export type CheckoutRequest = { memberId: string; email: string; companyName: string; promoCode?: string };
export type CheckoutResult =
  | { kind: "embedded"; clientSecret: string } // Stripe's embedded Checkout, mounted in a modal (B1.7)
  | { kind: "redirect"; url: string }   // Stripe-hosted page: Preview mocks, or no publishable key
  | { kind: "paid" }                    // payment settled (stub simulates success)
  | { kind: "comped"; months: number }  // valid promo code
  | { kind: "error"; message: string };

/**
 * A change to a subscription's renewal (cancel-at-period-end, and the #92
 * "keep renewing" call beside it). The failure
 * carries a reason, so the membership module can tell "Stripe has already
 * closed this subscription" (`period_ended`) from any other refusal; `error`
 * is Stripe's own message, for an admin, never for a member.
 */
export type RenewalChangeResult =
  | { ok: true }
  | { ok: false; reason: "period_ended" | "stripe_rejected"; error: string };

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
  cancelSubscription(subscriptionId: string): Promise<RenewalChangeResult>;
  /**
   * Undo a scheduled cancel (#92): `cancel_at_period_end` back to false, so
   * the subscription renews as normal. Same B1.6 rule — only ever the stored
   * subscription id. A subscription Stripe has already closed can't be
   * revived; that comes back as `period_ended`.
   */
  keepRenewing(subscriptionId: string): Promise<RenewalChangeResult>;
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

  async cancelSubscription(): Promise<RenewalChangeResult> {
    return { ok: true }; // nothing real to cancel — the member row itself is updated by the caller
  }

  async keepRenewing(): Promise<RenewalChangeResult> {
    return { ok: true }; // nothing real to resume — the caller clears the member row
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
    /** Where embedded Checkout sends the member when done; null → the hosted redirect instead. */
    private embeddedReturnUrl: string | null = null,
  ) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (req.promoCode) return redeemPromoCode(req.promoCode);
    if (this.embeddedReturnUrl) return this.createEmbeddedCheckout(req, this.embeddedReturnUrl);

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
   * GAPS B1.7: the same subscription, as an embedded Checkout Session the pay
   * page mounts in a modal. Follows createInvoiceCheckout (advert-checkout.ts):
   * the API version is pinned because `ui_mode: "embedded_page"` needs it and
   * must match the Stripe.js the page loads, and an Idempotency-Key means a
   * double click, or a modal closed and reopened within the minute, gets the
   * same session back rather than a second one the member could also pay.
   * Always the real API: Stripe.js can't run against the Preview mocks, which
   * keep the hosted redirect above (getPayments).
   */
  private async createEmbeddedCheckout(req: CheckoutRequest, returnUrl: string): Promise<CheckoutResult> {
    // One clock reading for the key and expires_at: Stripe rejects a reused
    // key whose parameters differ.
    const minute = Math.floor(Date.now() / 60_000);
    const body = new URLSearchParams({
      mode: "subscription",
      ui_mode: "embedded_page",
      "line_items[0][price]": this.priceId,
      "line_items[0][quantity]": "1",
      customer_email: req.email,
      client_reference_id: req.memberId,
      "metadata[kind]": MEMBERSHIP_CHECKOUT_KIND,
      "metadata[member_id]": req.memberId,
      // As on the redirect path: invoice.payment_failed carries the subscription.
      "subscription_data[metadata][member_id]": req.memberId,
      // Stripe fills in {CHECKOUT_SESSION_ID}; the pay page reads it back.
      return_url: returnUrl,
      // An hour, not Stripe's default 24: fewer stale sessions left payable.
      expires_at: String((minute + 60) * 60),
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": STRIPE_API_VERSION,
        "Idempotency-Key": `membership-checkout-${req.memberId}-${minute}`,
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { kind: "error", message: `Stripe rejected the checkout (${res.status}): ${detail.slice(0, 300)}` };
    }
    const session = (await res.json()) as { client_secret?: string };
    if (!session.client_secret) return { kind: "error", message: "Stripe did not return a checkout session." };
    return { kind: "embedded", clientSecret: session.client_secret };
  }

  /**
   * `cancel_at_period_end=true` on the subscription, not `DELETE` — Stripe's
   * documented distinction between "stop renewing" and "cancel now". The
   * actual state transition happens later, when Stripe's own
   * `customer.subscription.deleted` event fires at the period's real end
   * (see the webhook route) — this call only schedules it.
   */
  async cancelSubscription(subscriptionId: string): Promise<RenewalChangeResult> {
    return this.setCancelAtPeriodEnd(subscriptionId, true, "the cancellation");
  }

  /** The reverse of `cancelSubscription`: `cancel_at_period_end=false` on the same subscription (#92). */
  async keepRenewing(subscriptionId: string): Promise<RenewalChangeResult> {
    return this.setCancelAtPeriodEnd(subscriptionId, false, "the undo");
  }

  /** The one Stripe call behind both renewal changes; `what` names it in a refusal. */
  private async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean, what: string): Promise<RenewalChangeResult> {
    const res = await fetch(`${this.baseUrl}/v1/subscriptions/${subscriptionId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ cancel_at_period_end: String(cancel) }),
    });
    if (!res.ok) return subscriptionRefusal(res, what);
    return { ok: true };
  }
}

/**
 * Stripe's answer to a refused subscription update, as a RenewalChangeResult. Shared
 * by every renewal change (cancel, and keep-renewing from #92). Stripe's own
 * `error.message` is passed through when the body is its usual JSON, trimmed
 * to 300 characters as before; a subscription Stripe has already closed
 * ("A canceled subscription can only update its cancellation_details and
 * metadata.") becomes `period_ended`, since there is nothing left to change.
 */
async function subscriptionRefusal(res: Response, what: string): Promise<RenewalChangeResult> {
  const body = await res.text().catch(() => "");
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") message = parsed.error.message;
  } catch {
    // not JSON — keep the raw text
  }
  const error = `Stripe rejected ${what} (${res.status}): ${message.slice(0, 300)}`;
  return /canceled subscription/i.test(message)
    ? { ok: false, reason: "period_ended", error }
    : { ok: false, reason: "stripe_rejected", error };
}

/**
 * Whether membership checkout is the embedded modal (GAPS B1.7). It needs the
 * publishable key as well as the secret one, and the real API: without the
 * key, or on a Preview running the mocks, signups fall back to the hosted
 * redirect, which still takes payment.
 */
export function membershipCheckoutIsEmbedded(): boolean {
  return paymentsAreLive() && Boolean(stripePublishableKey()) && !mockBaseUrl();
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
      membershipCheckoutIsEmbedded() ? `${base}/dashboard/pay?session_id={CHECKOUT_SESSION_ID}` : null,
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
