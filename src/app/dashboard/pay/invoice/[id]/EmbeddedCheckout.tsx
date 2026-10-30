"use client";

import { useCallback } from "react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { createInvoiceCheckoutSession } from "../actions";

/**
 * Stripe's embedded Checkout for one advertising invoice (6 Oct), mounted
 * inside the member area. The Stripe.js loading lives in the shared
 * component, which the membership modal uses too (GAPS B1.7).
 */
export function EmbeddedCheckout({ invoiceId, publishableKey, stripeJsUrl }: { invoiceId: string; publishableKey: string; stripeJsUrl: string }) {
  const fetchClientSecret = useCallback(() => createInvoiceCheckoutSession(invoiceId), [invoiceId]);
  return <StripeEmbeddedCheckout fetchClientSecret={fetchClientSecret} publishableKey={publishableKey} stripeJsUrl={stripeJsUrl} />;
}
