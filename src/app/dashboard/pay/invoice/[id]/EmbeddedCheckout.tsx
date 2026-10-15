"use client";

import { useEffect, useRef, useState } from "react";
import { createInvoiceCheckoutSession } from "../actions";

type EmbeddedCheckoutPage = { mount: (el: HTMLElement) => void; destroy: () => void };
type StripeJs = {
  createEmbeddedCheckoutPage: (opts: { fetchClientSecret: () => Promise<string> }) => Promise<EmbeddedCheckoutPage>;
};
declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJs;
  }
}

/**
 * Stripe's embedded Checkout, mounted inside the member area (6 Oct; GAPS
 * B1.7 asked for embedded rather than a redirect). Stripe.js must be loaded
 * from js.stripe.com — never bundled — so it is injected here, once, and the
 * CSP in next.config.ts allows exactly that host.
 */
function loadStripeJs(src: string): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  return new Promise((resolve, reject) => {
    const script = existing ?? Object.assign(document.createElement("script"), { src, async: true });
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Stripe.js failed to load")), { once: true });
    if (!existing) document.head.appendChild(script);
  });
}

export function EmbeddedCheckout({ invoiceId, publishableKey, stripeJsUrl }: { invoiceId: string; publishableKey: string; stripeJsUrl: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let checkout: EmbeddedCheckoutPage | null = null;
    let cancelled = false;
    (async () => {
      try {
        await loadStripeJs(stripeJsUrl);
        if (cancelled || !window.Stripe || !ref.current) return;
        const page = await window.Stripe(publishableKey).createEmbeddedCheckoutPage({
          fetchClientSecret: () => createInvoiceCheckoutSession(invoiceId),
        });
        // React may have unmounted while Stripe was loading (StrictMode runs
        // effects twice in dev) — a second mount on the same node throws.
        if (cancelled) {
          page.destroy();
          return;
        }
        checkout = page;
        page.mount(ref.current);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "The payment form couldn't load.");
      }
    })();
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [invoiceId, publishableKey, stripeJsUrl]);

  return (
    <div>
      {error && <p role="alert" className="mb-3 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}
      <div ref={ref} id="checkout" className="min-h-[24rem]" aria-label="Secure card payment" />
    </div>
  );
}
