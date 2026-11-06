"use client";
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

/** The event a form carrying FormPendingSignal fires; `detail` is whether its action is running. */
export const FORM_PENDING_EVENT = "form-pending";

/**
 * Put inside a form whose submit buttons live elsewhere (`<button form="id">`):
 * those buttons can't read the form's pending state with useFormStatus, which
 * only sees the form a component sits in. This fires FORM_PENDING_EVENT on
 * the form each time its action starts and settles (#48).
 */
export function FormPendingSignal() {
  const { pending } = useFormStatus();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.closest("form")?.dispatchEvent(new CustomEvent(FORM_PENDING_EVENT, { detail: pending }));
  }, [pending]);
  return <span ref={ref} hidden />;
}
