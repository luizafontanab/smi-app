"use client";
import { useFormStatus } from "react-dom";
import { useUploadsPending } from "@/lib/upload-pending";

export function SubmitButton({
  children,
  pendingLabel,
  className = "w-full rounded bg-ink py-2.5 font-semibold text-white disabled:opacity-50",
  name,
  value,
  formNoValidate,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  /** For a second submit button in the same form (e.g. "Save draft"): the
   *  name/value pair it posts, and whether it skips native validation. */
  name?: string;
  value?: string;
  formNoValidate?: boolean;
}) {
  const { pending, data } = useFormStatus();
  // An editor image still uploading isn't in the form's data yet — saving now
  // would drop it, so the button waits with the editor.
  const uploading = useUploadsPending();
  // With two submit buttons, only the one that was pressed says it's working;
  // both are disabled either way. Convention: the secondary button posts an
  // `intent` (StoryForm's "Save draft"), so an unnamed button is "mine"
  // whenever no intent came through.
  const mine = name ? data?.get(name) === value : !data || data.get("intent") == null;
  return (
    <button type="submit" name={name} value={value} formNoValidate={formNoValidate} disabled={pending || uploading} className={className}>
      {pending && mine ? pendingLabel : uploading ? "Waiting for image…" : children}
    </button>
  );
}
