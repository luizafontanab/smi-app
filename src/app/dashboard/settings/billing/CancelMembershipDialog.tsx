"use client";

import { useRef } from "react";

/**
 * Confirmation for the cancel-membership action, on the platform <dialog>
 * element — same choice as MobileNav/DevTaskWidget: focus trap, Escape and an
 * inert background for free. Replaces the old required-checkbox gate with a
 * modal that spells out the terms before the member commits.
 */
export function CancelMembershipDialog({ action, joinedAt }: {
  action: (formData: FormData) => Promise<void>;
  joinedAt: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="mt-3 rounded border border-danger/30 px-4 py-2 text-sm text-danger hover:bg-danger/10"
      >
        Cancel my membership
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="cancel-membership-title"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        onClose={() => triggerRef.current?.focus()}
        className="m-auto w-[min(28rem,90vw)] rounded-xl border-0 p-0 shadow-lg backdrop:bg-black/40"
      >
        <div className="p-6">
          <h2 id="cancel-membership-title" className="text-lg font-bold text-ink">Cancel your membership?</h2>
          {joinedAt && <p className="mt-1 text-xs text-graphite">Member since {joinedAt}.</p>}
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-graphite">
            <li>Your membership stays active until the end of the current billing period — nothing is cut off today.</li>
            <li>You won&apos;t be charged again after that.</li>
            <li>Your public page and directory listing come down when the membership lapses.</li>
          </ul>
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded px-4 py-2 text-sm text-graphite hover:bg-shade"
            >
              Keep my membership
            </button>
            <form action={action}>
              <button className="rounded bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger/90">
                Cancel membership
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
