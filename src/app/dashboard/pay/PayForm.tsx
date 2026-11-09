"use client";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { payMembership, type PayState } from "./actions";

export type EmbedConfig = { publishableKey: string; stripeJsUrl: string };

export function PayForm({ embed = null }: { embed?: EmbedConfig | null }) {
  const [state, formAction, pending] = useActionState(payMembership, { message: "" });
  // Which result the member closed. Each submit returns a new state object,
  // so paying again reopens the modal even when Stripe hands back the same
  // session (the adapter's idempotency key does that within a minute).
  const [closed, setClosed] = useState<PayState | null>(null);
  const secret = embed && state.clientSecret && state !== closed ? state.clientSecret : null;

  return (
    <>
      <form action={formAction} className="mt-5 space-y-4">
        <div>
          <label htmlFor="promo" className="text-sm font-medium">Promo code (optional)</label>
          <input id="promo" name="promo" placeholder="e.g. from your welcome letter" className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        {state?.message && <p aria-live="polite" className="rounded bg-danger/10 p-2 text-sm text-danger">{state.message}</p>}
        <button disabled={pending} className="w-full rounded bg-ink py-2.5 font-semibold text-white disabled:opacity-50">
          {pending ? "Processing…" : "Pay £40/month"}
        </button>
      </form>
      {secret && embed && <CheckoutDialog secret={secret} embed={embed} onClose={() => setClosed(state)} />}
    </>
  );
}

/**
 * GAPS B1.7 / V13: Stripe's embedded Checkout in a modal, so the member never
 * leaves the site. Platform <dialog>, like DeleteMemberDialog in the console:
 * focus trap, Escape and an inert background for free. A click on the backdrop does NOT
 * close it, so a stray click can't throw away half-entered card details.
 * Closing unmounts the form (Stripe's instance is destroyed with it). Once
 * the payment goes through, Stripe sends the whole page to the return URL.
 */
function CheckoutDialog({ secret, embed, onClose }: { secret: string; embed: EmbedConfig; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fetchClientSecret = useCallback(() => Promise.resolve(secret), [secret]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="pay-membership-title"
      onClose={onClose}
      className="m-auto max-h-[92vh] w-[min(40rem,94vw)] overflow-y-auto rounded-xl border-0 p-0 shadow-lg backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="pay-membership-title" className="font-bold text-ink">Pay £40/month</h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close payment form"
          className="rounded px-2 py-1 text-xl leading-none text-graphite hover:bg-shade"
        >
          ×
        </button>
      </div>
      <div className="p-4">
        <StripeEmbeddedCheckout fetchClientSecret={fetchClientSecret} publishableKey={embed.publishableKey} stripeJsUrl={embed.stripeJsUrl} />
      </div>
    </dialog>
  );
}
