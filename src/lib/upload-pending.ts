"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";

/**
 * How many uploads — editor images and direct-upload file fields — are in
 * flight on this page, per form. A module-level store rather than a context:
 * the forms that need it (SubmitButton inside a server-rendered console page)
 * have no common client parent to hang a provider on, and there is only ever
 * one page's worth of forms mounted.
 *
 * Counted per form (#48 review): SubmitButton is on every form, so a
 * page-wide count would grey out Sign out and every other form's button while
 * one form uploads. An upload with no form (null) still holds every button.
 */
const pending = new Map<Element | null, number>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** `form`: the form the upload belongs to, if it's in one. */
export function beginUpload(form: Element | null = null) {
  pending.set(form, (pending.get(form) ?? 0) + 1);
  emit();
}

export function endUpload(form: Element | null = null) {
  const left = (pending.get(form) ?? 0) - 1;
  if (left > 0) pending.set(form, left);
  else pending.delete(form);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * True while the form `inside` sits in is still uploading, or an upload with
 * no form is. Without `inside`: while anything on the page is uploading.
 */
export function useUploadsPending(inside?: RefObject<HTMLElement | null>): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      if (!inside) return pending.size > 0;
      const form = inside.current?.closest("form") ?? null;
      return pending.has(null) || (form !== null && pending.has(form));
    },
    () => false,
  );
}

/**
 * While `active`, refuse to submit the form `inside` sits in, and call
 * `onHold` to say why. Every form gets this whatever its button is — not all
 * of them use SubmitButton — by stopping the submit at the form itself, in
 * the capture phase, before React's root listener sees it. Without it a save
 * mid-upload posts the form without the file, silently.
 *
 * `onHold` should be stable (a state setter, or wrapped in useCallback): it is
 * an effect dependency.
 */
export function useHoldSubmit(inside: RefObject<HTMLElement | null>, active: boolean, onHold: () => void) {
  useEffect(() => {
    const form = inside.current?.closest("form");
    if (!form || !active) return;
    const hold = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      onHold();
    };
    form.addEventListener("submit", hold, true);
    return () => form.removeEventListener("submit", hold, true);
  }, [inside, active, onHold]);
}
