"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FORM_PENDING_EVENT } from "@/components/FormPendingSignal";

/**
 * A Confirm button under "Social post" (issue #43). Confirming snapshots the
 * SAVED item, so while the editor's form has unsaved changes the button is
 * off and says "Save first" — otherwise an admin would confirm text other
 * than what they're looking at. Same input/change signal as
 * UnsavedChangesGuard, watched on the editor form it sits in.
 *
 * It submits `form` (SocialConfirmForm, outside the editor form), not the
 * editor: as a submit button of the editor form it would be the one Enter
 * presses, ahead of Save.
 */
export function SocialConfirmButton({
  form,
  value,
  disabled = false,
  children,
}: {
  /** The id of the SocialConfirmForm. */
  form: string;
  /** A channel id, or "all". */
  value: string;
  /** Off for another reason, already explained next to it (Buffer couldn't be reached). */
  disabled?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const [dirty, setDirty] = useState(false);
  // #48: off from the first click until the confirm settles. `form` is another
  // form, so its pending state arrives as FormPendingSignal's event, not useFormStatus.
  const [pending, setPending] = useState(false);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const target = ref.current?.form;
    if (!target) return;
    // off straight away, not a render later when the pending event arrives: no gap for a second click
    const onSubmit = (e: SubmitEvent) => {
      setPressed(e.submitter === ref.current);
      setPending(true);
    };
    const onPending = (e: Event) => setPending((e as CustomEvent<boolean>).detail);
    target.addEventListener("submit", onSubmit);
    target.addEventListener(FORM_PENDING_EVENT, onPending);
    return () => {
      target.removeEventListener("submit", onSubmit);
      target.removeEventListener(FORM_PENDING_EVENT, onPending);
    };
  }, []);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const markDirty = (e: Event) => {
      // the per-channel boxes are part of the form too: ticking one is an unsaved change
      if (e.target instanceof HTMLElement && e.target.closest("form") === form) setDirty(true);
    };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    return () => {
      form.removeEventListener("input", markDirty);
      form.removeEventListener("change", markDirty);
    };
  }, []);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        ref={ref}
        type="submit"
        form={form}
        name="confirm_channel"
        value={value}
        disabled={dirty || disabled || pending}
        aria-busy={(pending && pressed) || undefined}
        aria-describedby={dirty ? hintId : undefined}
        className="rounded border border-ink px-3 py-1 text-sm font-medium text-ink hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending && pressed ? "Confirming…" : children}
      </button>
      {dirty && <span id={hintId} className="text-xs text-graphite">Save first</span>}
    </span>
  );
}
