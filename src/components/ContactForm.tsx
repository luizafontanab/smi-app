"use client";
import { useActionState } from "react";
import { sendContactMessage } from "@/app/(public)/actions";

export function ContactForm({ kind }: { kind: "contact" | "advertising" }) {
  const [state, formAction, pending] = useActionState(sendContactMessage, { message: "" });
  return (
    <form data-part="form" action={formAction} className="space-y-4">
      <input type="hidden" name="kind" value={kind} />
      <div>
        <label data-part="form-label" htmlFor="name" className="text-sm font-medium">Name</label>
        <input data-part="form-input" id="name" name="name" autoComplete="name" required aria-required="true" aria-describedby="contact-status" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label data-part="form-label" htmlFor="email" className="text-sm font-medium">Email</label>
        <input data-part="form-input" id="email" type="email" name="email" autoComplete="email" required aria-required="true" aria-describedby="contact-status" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label data-part="form-label" htmlFor="message" className="text-sm font-medium">{kind === "advertising" ? "What are you interested in?" : "Message"}</label>
        <textarea data-part="form-input" id="message" name="message" required rows={5} aria-required="true" aria-describedby="contact-status" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {/* Full width, like the join and sign-in submits (#33). */}
      <button data-part="button-primary" disabled={pending} className="w-full rounded bg-ink px-5 py-2.5 font-semibold text-white disabled:opacity-50">
        {pending ? "Sending…" : "Send"}
      </button>
      {/* Always rendered: a live region announces only if it existed before
          the message arrived. */}
      <p data-part="form-notice" id="contact-status" aria-live="polite" className={state?.message ? "text-sm text-graphite" : "sr-only"}>{state?.message}</p>
    </form>
  );
}
