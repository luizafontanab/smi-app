"use client";
import { useActionState } from "react";
import { sendContactMessage } from "@/app/(public)/actions";

export function ContactForm({ kind }: { kind: "contact" | "advertising" }) {
  const [state, formAction, pending] = useActionState(sendContactMessage, { message: "" });
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="kind" value={kind} />
      <div>
        <label htmlFor="name" className="text-sm font-medium">Name</label>
        <input id="name" name="name" required className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input id="email" type="email" name="email" required className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="message" className="text-sm font-medium">{kind === "advertising" ? "What are you interested in?" : "Message"}</label>
        <textarea id="message" name="message" required rows={5} className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <button disabled={pending} className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">
        {pending ? "Sending…" : "Send"}
      </button>
      {state?.message && <p aria-live="polite" className="text-sm text-graphite">{state.message}</p>}
    </form>
  );
}
