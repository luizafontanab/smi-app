/**
 * Payments adapter (TECH-DECISIONS #16): Stripe in production, stub locally.
 * Constraint: existing Stripe subscriptions are never touched; members never
 * interact with Stripe directly (invoices served via the member area).
 */

export type CheckoutRequest = { email: string; companyName: string; promoCode?: string };
export type CheckoutResult =
  | { kind: "redirect"; url: string }   // Stripe-hosted checkout (production)
  | { kind: "paid" }                    // payment settled (stub simulates success)
  | { kind: "comped"; months: number }  // valid promo code
  | { kind: "error"; message: string };

export interface Payments {
  /** Create a £40/mo subscription checkout; promo codes (1mo/12mo free) apply here. */
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
}

const LOCAL_PROMO_CODES: Record<string, number> = { "SMI-FREE-MONTH": 1, "SMI-FREE-YEAR": 12 };

class LocalStubPayments implements Payments {
  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (req.promoCode) {
      const months = LOCAL_PROMO_CODES[req.promoCode.trim().toUpperCase()];
      if (!months) return { kind: "error", message: "Unknown promo code." };
      return { kind: "comped", months };
    }
    return { kind: "paid" }; // local dev: card payment simulated as successful
  }
}

export function getPayments(): Payments {
  // Stripe implementation lands behind STRIPE_SECRET_KEY (test mode first).
  return new LocalStubPayments();
}
