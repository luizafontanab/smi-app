"use client";
import { useActionState } from "react";
import { payMembership } from "./actions";

export function PayForm() {
  const [state, formAction, pending] = useActionState(payMembership, { message: "" });
  return (
    <form action={formAction} className="mt-5 space-y-4">
      <div>
        <label htmlFor="promo" className="text-sm font-medium">Promo code (optional)</label>
        <input id="promo" name="promo" placeholder="e.g. from your welcome letter" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {state?.message && <p aria-live="polite" className="rounded bg-red-50 p-2 text-sm text-red-600">{state.message}</p>}
      <button disabled={pending} className="w-full rounded bg-ink py-2.5 font-semibold text-white disabled:opacity-50">
        {pending ? "Processing…" : "Pay £40/month"}
      </button>
    </form>
  );
}
