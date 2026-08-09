/**
 * Payments adapter (TECH-DECISIONS #16): Stripe in production, stub locally.
 * Constraint: existing Stripe subscriptions are never touched; members never
 * interact with Stripe directly (invoices served via the member area).
 */

export type CheckoutRequest = { email: string; companyName: string; promoCode?: string };
export type CheckoutResult = { url: string } | { comped: true } | { error: string };

export interface Payments {
  /** Create a £40/mo subscription checkout; promo codes (1mo/12mo free) apply here. */
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
}

class LocalStubPayments implements Payments {
  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (req.promoCode) return { comped: true };
    return { url: "/join/checkout" }; // local stub page
  }
}

export function getPayments(): Payments {
  // Stripe implementation lands behind STRIPE_SECRET_KEY (test mode first).
  return new LocalStubPayments();
}
