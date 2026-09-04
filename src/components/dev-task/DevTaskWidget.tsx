"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useActionState } from "react";
import { submitDevTask } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { DEV_PRIORITIES, DEV_TASK_KINDS, DEV_TASK_KIND_LABELS } from "@/lib/dev-tasks";
import { collectDevTaskContext, installErrorCapture } from "./client-context";

/**
 * Floating "Report a bug" button + modal, rendered only for admins by
 * DevTaskLauncher. Uses the platform <dialog> element rather than a
 * hand-rolled overlay: it gives focus trap, Escape, an inert background and
 * — the load-bearing part — the top layer, which sidesteps a z-index fight
 * with CookieConsent (z-50) and sticky headers without extra work.
 *
 * Structure: an always-mounted <dialog> (so showModal()/close() work)
 * wrapping a key-remounted inner form.
 */
export function DevTaskWidget({ reporterName }: { reporterName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [openCount, setOpenCount] = useState(0); // remount key
  const [flash, setFlash] = useState("");
  const titleId = useId();

  // Installed here, not in the dialog: the errors worth reporting are the
  // ones thrown while browsing, before anyone decides to report anything.
  useEffect(() => installErrorCapture(), []);

  function open() {
    setOpenCount((n) => n + 1);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      {flash && (
        <p aria-live="polite" className="fixed bottom-24 right-4 z-50 rounded bg-success/10 p-2 text-sm text-success shadow-lg">
          {flash}
        </p>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-chrome px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-chrome-hover print:hidden"
      >
        Feedback
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        // p-0 is load-bearing — a click on the dialog's own padding must not
        // read as a backdrop click and discard a half-typed report.
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        onClose={() => triggerRef.current?.focus()}
        className="m-auto w-[min(34rem,92vw)] rounded-lg border bg-white p-0 shadow-lg backdrop:bg-black/40"
      >
        <DevTaskForm
          key={openCount}
          titleId={titleId}
          reporterName={reporterName}
          onCancel={close}
          onSuccess={(message) => {
            close();
            setFlash(message);
          }}
        />
      </dialog>
    </>
  );
}

function DevTaskForm({
  titleId,
  reporterName,
  onCancel,
  onSuccess,
}: {
  titleId: string;
  reporterName: string;
  onCancel: () => void;
  onSuccess: (message: string) => void;
}) {
  const [state, formAction] = useActionState(submitDevTask, { message: "" });

  useEffect(() => {
    if (state.ok) onSuccess(state.message);
    // Fire only on a fresh action result, not on onSuccess's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [state]);

  // Context is captured here, at submit time — never during render.
  function action(formData: FormData) {
    formData.set("context", JSON.stringify(collectDevTaskContext()));
    formAction(formData);
  }

  return (
    <form action={action} className="p-5">
      <h2 id={titleId} className="text-lg font-bold text-ink">
        Feedback
      </h2>
      <p className="mt-1 text-xs text-graphite">
        Filing as {reporterName}. The page, browser and any recent errors are attached automatically.
      </p>

      <div className="mt-4">
        <label htmlFor="dev-task-title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="dev-task-title"
          name="title"
          required
          autoFocus
          maxLength={200}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="dev-task-kind" className="text-sm font-medium">
            Kind
          </label>
          <select id="dev-task-kind" name="kind" defaultValue="bug" className="mt-1 w-full rounded border px-3 py-2">
            {DEV_TASK_KINDS.map((k) => (
              <option key={k} value={k}>
                {DEV_TASK_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dev-task-priority" className="text-sm font-medium">
            Priority
          </label>
          <select id="dev-task-priority" name="priority" defaultValue="medium" className="mt-1 w-full rounded border px-3 py-2">
            {DEV_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="dev-task-description" className="text-sm font-medium">
          Description (optional)
        </label>
        <textarea id="dev-task-description" name="description" rows={4} className="mt-1 w-full rounded border px-3 py-2" />
      </div>

      {state.message && !state.ok && (
        <p aria-live="polite" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">
          {state.message}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded border px-4 py-2 text-sm">
          Cancel
        </button>
        <SubmitButton pendingLabel="Logging…" className="rounded bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Log it
        </SubmitButton>
      </div>
    </form>
  );
}
