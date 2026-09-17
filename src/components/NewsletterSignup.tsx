"use client";
import { useActionState } from "react";
import { subscribeNewsletter } from "@/app/(public)/actions";

/**
 * `tone` is the submit button only — the form is otherwise surface-agnostic.
 * "brand" (the default, unchanged) is the orange button on the dark footer and
 * on light bands; "dark" is for the grid homepage's orange newsletter panel,
 * where an orange button on orange would be invisible.
 */
const BUTTON_TONES = {
  brand: "bg-brand text-ink",
  dark: "bg-ink text-white",
} as const;

export function NewsletterSignup({ tone = "brand" }: { tone?: keyof typeof BUTTON_TONES }) {
  const [state, formAction, pending] = useActionState(subscribeNewsletter, { message: "" });
  return (
    <form action={formAction} className="flex gap-2">
      <label htmlFor="newsletter-email" className="sr-only">Email address</label>
      <input
        id="newsletter-email"
        type="email"
        name="email"
        required
        aria-required="true"
        aria-describedby="newsletter-status"
        placeholder="you@company.co.uk"
        className="w-full rounded px-3 py-2 text-sm text-ink placeholder:text-graphite bg-white"
      />
      <button disabled={pending} className={`rounded px-4 py-2 text-sm font-semibold disabled:opacity-50 ${BUTTON_TONES[tone]}`}>
        {pending ? "…" : "Subscribe"}
      </button>
      {/* Always rendered: a live region announces only if it existed before
          the message arrived. */}
      {/* Inherits the surface's foreground: this form renders on the dark
          footer and on light bands, and no single orange passes AA on both.
          Weight, not hue, carries the emphasis. */}
      <p id="newsletter-status" aria-live="polite" className={state?.message ? "text-xs font-semibold" : "sr-only"}>{state?.message}</p>
    </form>
  );
}
