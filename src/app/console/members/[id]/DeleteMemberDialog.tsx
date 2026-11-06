"use client";

import { useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Typed confirmation for a permanent member delete, on the platform <dialog>
 * element — the same choice as CancelMembershipDialog under /dashboard/settings
 * (focus trap, Escape and an inert background for free), with the extra step
 * that the company name has to be typed out.
 *
 * The typing is a speed bump, not a security control: `deleteMember` itself
 * refuses without `confirm=1` and refuses outright once the member has invoices,
 * placements, adverts or bundles. This is what stops the wrong row going in the
 * first place, which is the failure the server cannot catch.
 */
export function DeleteMemberDialog({ action, id, name, archived }: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  name: string;
  archived: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === name.trim();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded border border-danger/30 px-4 py-2 text-sm text-danger hover:bg-danger/10"
      >
        Delete permanently…
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="delete-member-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        onClose={() => {
          setTyped("");
          triggerRef.current?.focus();
        }}
        className="m-auto w-[min(30rem,90vw)] rounded-xl border-0 p-0 shadow-lg backdrop:bg-black/40"
      >
        <div className="p-6">
          <h2 id="delete-member-title" className="text-lg font-bold text-ink">Delete {name}?</h2>
          <p className="mt-2 text-sm text-graphite">This cannot be undone. Deleting removes:</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-graphite">
            <li>their company page, logo and hero image;</li>
            <li>their login, so they can no longer sign in;</li>
            <li>their notifications, saved services, membership types and CRM marks.</li>
          </ul>
          <p className="mt-3 text-sm text-graphite">
            A member with invoices, featured placements, adverts or bundles cannot be deleted at all —
            {archived ? " they are already archived, which is the right home for them." : " archive them instead."}
          </p>
          <label htmlFor="delete-member-confirm" className="mt-4 block text-sm font-medium text-ink">
            Type <span className="font-bold">{name}</span> to confirm
          </label>
          <input
            id="delete-member-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
          />
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded px-4 py-2 text-sm text-graphite hover:bg-shade"
            >
              Keep this member
            </button>
            <form action={action}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="confirm" value="1" />
              <SubmitButton
                pendingLabel="Deleting…"
                disabled={!matches}
                className="rounded bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger/90 disabled:opacity-40"
              >
                Delete permanently
              </SubmitButton>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
