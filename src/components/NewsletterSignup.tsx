"use client";
import { useActionState } from "react";
import { subscribeNewsletter } from "@/app/(public)/actions";

export function NewsletterSignup() {
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
      <button disabled={pending} className="rounded bg-brand px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">
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
