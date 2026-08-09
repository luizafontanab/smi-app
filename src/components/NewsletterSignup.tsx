"use client";
import { useActionState } from "react";
import { subscribeNewsletter } from "@/app/(public)/actions";

export function NewsletterSignup() {
  const [state, formAction, pending] = useActionState(subscribeNewsletter, { message: "" });
  return (
    <form action={formAction} className="flex gap-2">
      <input
        type="email"
        name="email"
        required
        placeholder="you@company.co.uk"
        className="w-full rounded px-3 py-2 text-sm text-ink placeholder:text-gray-400 bg-white"
      />
      <button disabled={pending} className="rounded bg-amber px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50">
        {pending ? "…" : "Subscribe"}
      </button>
      {state?.message && <p aria-live="polite" className="text-xs text-amber">{state.message}</p>}
    </form>
  );
}
