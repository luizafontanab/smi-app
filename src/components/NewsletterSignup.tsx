"use client";
import { useActionState, useId } from "react";
import { subscribeNewsletter } from "@/app/(public)/actions";
import type { SignupSurface } from "@/lib/newsletter-consent";

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

/**
 * `surface` says which copy surrounds this form (lib/newsletter-consent), so
 * the signup records the wording the person actually saw (gap review area 6).
 */
export function NewsletterSignup({ surface, tone = "brand" }: { surface: SignupSurface; tone?: keyof typeof BUTTON_TONES }) {
  const [state, formAction, pending] = useActionState(subscribeNewsletter, { message: "" });
  // Per instance: a page block and the footer can both render this form, and
  // fixed ids pointed the second one's label and status at the first (#33).
  const id = useId();
  const emailId = `${id}-email`;
  const statusId = `${id}-status`;
  return (
    <form data-part="newsletter-signup" action={formAction} className="flex flex-wrap gap-2">
      <input type="hidden" name="surface" value={surface} />
      <label htmlFor={emailId} className="sr-only">Email address</label>
      {/* 16px below sm so iOS doesn't zoom in on focus; 44px tall on phones. */}
      <input data-part="form-input"
        id={emailId}
        type="email"
        name="email"
        autoComplete="email"
        required
        aria-required="true"
        aria-describedby={statusId}
        placeholder="you@company.co.uk"
        className="min-w-0 flex-1 rounded bg-white px-3 py-2.5 text-base text-ink placeholder:text-graphite sm:py-2 sm:text-sm"
      />
      <button data-part="button-primary" disabled={pending} className={`rounded px-4 py-2 text-sm font-semibold disabled:opacity-50 ${BUTTON_TONES[tone]}`}>
        {pending ? "…" : "Subscribe"}
      </button>
      {/* Always rendered: a live region announces only if it existed before
          the message arrived. basis-full puts it on its own line under the
          field rather than squeezed in beside the button. */}
      {/* Inherits the surface's foreground: this form renders on the dark
          footer and on light bands, and no single orange passes AA on both.
          Weight, not hue, carries the emphasis. */}
      <p data-part="form-notice" id={statusId} aria-live="polite" className={state?.message ? "basis-full text-xs font-semibold" : "sr-only"}>{state?.message}</p>
    </form>
  );
}
