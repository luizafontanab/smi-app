"use client";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useUploadsPending } from "@/lib/upload-pending";

const DEFAULT_CLASS = "w-full rounded bg-ink py-2.5 font-semibold text-white disabled:opacity-50";

/**
 * The one button for anything that submits a form (#48). From the first click
 * until the form's action settles, every submit button in the form is
 * disabled, so a second click does nothing, and the one that was pressed shows
 * `pendingLabel`. It re-enables when the action finishes or throws.
 *
 * Takes the usual <button> attributes (aria-label, formAction, onClick, a
 * `disabled` of its own …) except `type`, which is always "submit", and
 * `form`: it must sit inside its form, the only one useFormStatus can see. A
 * button that submits another form uses FormPendingSignal instead (see
 * SocialConfirmButton).
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = DEFAULT_CLASS,
  disabled,
  ...rest
}: Omit<ComponentProps<"button">, "type" | "children" | "form"> & {
  children: ReactNode;
  /** What the pressed button says while its action runs, e.g. "Saving…". */
  pendingLabel: ReactNode;
}) {
  const { pending, data } = useFormStatus();
  // An upload still in flight (an editor image, a direct-upload file field)
  // isn't in the form's data yet — saving now would drop it, so the button waits.
  const ref = useRef<HTMLButtonElement>(null);
  const uploading = useUploadsPending(ref);
  // Which button the browser says submitted the form, recorded on every
  // submit. null when it can't say (a script's requestSubmit() with no button).
  const [pressed, setPressed] = useState<boolean | null>(null);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => setPressed(e.submitter ? e.submitter === ref.current : null);
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);

  // Without a submitter to go on: a named button is "mine" if its name/value
  // came through; an unnamed one if no `intent` did (the secondary-button
  // convention, StoryForm's "Save draft").
  const mine =
    pressed ?? (rest.name ? data?.get(rest.name) === rest.value : !data || data.get("intent") == null);
  const working = pending && mine;
  return (
    <button
      {...rest}
      ref={ref}
      type="submit"
      disabled={pending || uploading || disabled}
      aria-busy={working || undefined}
      className={className.includes("disabled:opacity") ? className : `${className} disabled:opacity-50`}
    >
      {working ? pendingLabel : uploading ? "Waiting for upload…" : children}
    </button>
  );
}
