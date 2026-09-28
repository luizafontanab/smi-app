"use client";
import { useActionState } from "react";
import { createAccount } from "./actions";
import { RequiredMark } from "@/components/RequiredMark";

/**
 * Membership types are picked here, at signup, as V13 step 1 describes — the
 * same checkboxes (and the same `membership_types` field) as the company-page
 * form, where they stay editable afterwards (GAPS A8.1).
 */
export function AccountForm({ membershipTypes, maxTypes }: { membershipTypes: { id: number; name: string }[]; maxTypes: number }) {
  const [state, formAction, pending] = useActionState(createAccount, { message: "" });
  return (
    <form action={formAction} className="mt-5 space-y-4">
      <div>
        <label htmlFor="company" className="text-sm font-medium">Company name<RequiredMark /></label>
        <input id="company" name="company" required aria-required="true" aria-invalid={state?.message ? true : undefined} aria-describedby="account-error" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="email" className="text-sm font-medium">Email<RequiredMark /></label>
        <input id="email" type="email" name="email" required aria-required="true" aria-invalid={state?.message ? true : undefined} aria-describedby="account-error" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-medium">Password (8+ characters)<RequiredMark /></label>
        <input id="password" type="password" name="password" required minLength={8} aria-required="true" aria-invalid={state?.message ? true : undefined} aria-describedby="account-error" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="phone" className="text-sm font-medium">Phone <span className="font-normal text-graphite">(optional)</span></label>
        <input id="phone" name="phone" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="website" className="text-sm font-medium">Website <span className="font-normal text-graphite">(optional)</span></label>
        <input id="website" name="website" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="address" className="text-sm font-medium">Address <span className="font-normal text-graphite">(optional)</span></label>
        <input id="address" name="address" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {membershipTypes.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium">What kind of business are you? <span className="font-normal text-graphite">(optional)</span></legend>
          <p className="text-xs text-graphite">Tick every one that applies, up to {maxTypes}. Readers can filter Find a Member by these.</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {membershipTypes.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="membership_types" value={t.id} />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="text-xs text-graphite">Anything you fill in here is already on your company page when you get to it — no need to retype it.</p>
      {/* Always in the DOM so the live region exists before a message lands —
          announced reliably, and addressable from each field's describedby. */}
      <p id="account-error" aria-live="polite" className={state?.message ? "rounded bg-danger/10 p-2 text-sm text-danger" : "sr-only"}>
        {state?.message}
      </p>
      <button disabled={pending} className="w-full rounded bg-ink py-2.5 font-semibold text-white disabled:opacity-50">
        {pending ? "Creating your account…" : "Create account & continue"}
      </button>
    </form>
  );
}
