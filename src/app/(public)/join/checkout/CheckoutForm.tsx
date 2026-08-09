"use client";
import { useActionState } from "react";
import { joinCheckout } from "./actions";

export function CheckoutForm() {
  const [state, formAction, pending] = useActionState(joinCheckout, { message: "" });
  return (
    <form action={formAction} className="mt-5 space-y-4">
      <div>
        <label className="text-sm font-medium">Company name</label>
        <input name="company" required className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label className="text-sm font-medium">Email</label>
        <input type="email" name="email" required className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label className="text-sm font-medium">Password (8+ characters)</label>
        <input type="password" name="password" required minLength={8} className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label className="text-sm font-medium">Promo code (optional)</label>
        <input name="promo" placeholder="e.g. from your welcome letter" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {state?.message && <p aria-live="polite" className="rounded bg-red-50 p-2 text-sm text-red-600">{state.message}</p>}
      <button disabled={pending} className="w-full rounded bg-navy py-2.5 font-semibold text-white disabled:opacity-50">
        {pending ? "Setting up your page…" : "Pay £40/month & create my page"}
      </button>
    </form>
  );
}
