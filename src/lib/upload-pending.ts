"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";

/**
 * How many uploads — editor images and direct-upload file fields — are in
 * flight on this page. A module-level counter rather than a context: the
 * forms that need it (SubmitButton inside a server-rendered console page)
 * have no common client parent to hang a provider on, and there is only ever
 * one page's worth of forms mounted.
 */
let pending = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function beginUpload() {
  pending += 1;
  emit();
}

export function endUpload() {
  pending = Math.max(0, pending - 1);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while anything on the page is still uploading. */
export function useUploadsPending(): boolean {
  return useSyncExternalStore(subscribe, () => pending > 0, () => false);
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
