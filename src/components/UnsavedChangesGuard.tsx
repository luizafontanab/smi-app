"use client";
import { useEffect, useRef } from "react";

const MESSAGE = "You have unsaved changes — leave this page?";

/**
 * Warns before navigating away from a form with unedited-but-unsaved input.
 * Render it anywhere inside the <form> it should guard; it renders no UI.
 *
 * - Dirty on the form's `input`/`change` events; clean again on `submit`
 *   (which fires before the server action navigates).
 * - Hard navigations (reload, tab close, external links) go through
 *   `beforeunload`, which shows the browser's native prompt.
 * - App Router client-side navigations have no route-change event, so
 *   internal-link clicks are intercepted with a capture-phase document
 *   listener and a `confirm()` — the standard App Router workaround.
 *
 * Each instance guards only the form it is rendered in, so several forms on
 * one page can carry their own guard.
 */
export function UnsavedChangesGuard() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;

    let dirty = false;
    const markDirty = () => {
      dirty = true;
    };
    const clearDirty = () => {
      dirty = false;
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      // Legacy channel; some browsers still require it for the prompt.
      event.returnValue = MESSAGE;
    };

    const onDocumentClick = (event: MouseEvent) => {
      if (!dirty) return;
      // Another guard on this page already blocked the click.
      if (event.defaultPrevented) return;
      // Only plain primary-button clicks navigate the current tab.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // External links fall through to beforeunload's native prompt.
      if (url.origin !== window.location.origin) return;
      // In-page hash jumps don't leave the page.
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      if (window.confirm(MESSAGE)) {
        // Leaving deliberately — don't prompt again from beforeunload.
        dirty = false;
      } else {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    form.addEventListener("submit", clearDirty);
    window.addEventListener("beforeunload", onBeforeUnload);
    // Capture phase: runs ahead of the router's Link click handling.
    document.addEventListener("click", onDocumentClick, true);

    return () => {
      form.removeEventListener("input", markDirty);
      form.removeEventListener("change", markDirty);
      form.removeEventListener("submit", clearDirty);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, []);

  return <span ref={ref} hidden />;
}
