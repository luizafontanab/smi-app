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
        <input id="company" name="company" autoComplete="organization" required aria-required="true" aria-invalid={state?.message ? true : undefined} aria-describedby="account-error" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="email" className="text-sm font-medium">Email<RequiredMark /></label>
        <input id="email" type="email" name="email" autoComplete="email" required aria-required="true" aria-invalid={state?.message ? true : undefined} aria-describedby="account-error" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-medium">Password (8+ characters)<RequiredMark /></label>
        <input id="password" type="password" name="password" autoComplete="new-password" required minLength={8} aria-required="true" aria-invalid={state?.message ? true : undefined} aria-describedby="account-error" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="phone" className="text-sm font-medium">Phone <span className="font-normal text-graphite">(optional)</span></label>
        <input id="phone" type="tel" name="phone" autoComplete="tel" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="website" className="text-sm font-medium">Website <span className="font-normal text-graphite">(optional)</span></label>
        {/* type="text" + inputMode="url", not type="url": the browser would then
            refuse "acme.co.uk" without a scheme, which the action accepts. (#33) */}
        <input id="website" name="website" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="address" className="text-sm font-medium">Address <span className="font-normal text-graphite">(optional)</span></label>
        <input id="address" name="address" autoComplete="street-address" className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {membershipTypes.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium">What kind of business are you? <span className="font-normal text-graphite">(optional)</span></legend>
          <p className="text-sm text-graphite sm:text-xs">Tick every one that applies, up to {maxTypes}. Readers can filter Find a Member by these.</p>
          {/* Each row is a 44px touch target with a 20px box — the native
              13px checkbox was easy to mis-tap on a phone (#33). */}
          <div className="mt-1 flex flex-col sm:flex-row sm:flex-wrap sm:gap-x-4">
            {membershipTypes.map((t) => (
              <label key={t.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-base sm:text-sm sm:pointer-fine:min-h-8">
                <input type="checkbox" name="membership_types" value={t.id} className="h-5 w-5 shrink-0 accent-brand" />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="text-sm text-graphite sm:text-xs">Anything you fill in here is already on your company page when you get to it — no need to retype it.</p>
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
