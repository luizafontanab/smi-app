"use client";

import { useSyncExternalStore } from "react";

/**
 * How many editor image uploads are in flight on this page. A module-level
 * counter rather than a context: the forms that need it (SubmitButton inside a
 * server-rendered console page) have no common client parent to hang a
 * provider on, and there is only ever one page's worth of editors mounted.
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

/** True while any editor on the page is still uploading an image. */
export function useUploadsPending(): boolean {
  return useSyncExternalStore(subscribe, () => pending > 0, () => false);
}
