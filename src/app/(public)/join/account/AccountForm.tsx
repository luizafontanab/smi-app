"use client";
import { useActionState } from "react";
import { createAccount } from "./actions";

export function AccountForm() {
  const [state, formAction, pending] = useActionState(createAccount, { message: "" });
  return (
    <form action={formAction} className="mt-5 space-y-4">
      <div>
        <label htmlFor="company" className="text-sm font-medium">Company name</label>
        <input id="company" name="company" required className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <input id="email" type="email" name="email" required className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="text-sm font-medium">Password (8+ characters)</label>
        <input id="password" type="password" name="password" required minLength={8} className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {state?.message && <p aria-live="polite" className="rounded bg-red-50 p-2 text-sm text-red-600">{state.message}</p>}
      <button disabled={pending} className="w-full rounded bg-ink py-2.5 font-semibold text-white disabled:opacity-50">
        {pending ? "Creating your account…" : "Create account & continue"}
      </button>
    </form>
  );
}
