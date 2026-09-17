"use client";

import { useEffect } from "react";

/**
 * Scrolls to `location.hash` once on mount, for full-page loads only.
 *
 * Why: a plain GET form whose action carries a fragment (`/news#all-news`,
 * fix list item 33) keeps the fragment in the URL in every browser, but
 * WebKit/Safari does not scroll to it on the resulting load — the visitor
 * lands at the top of the page. Chromium and Firefox already scroll, so the
 * extra call is a no-op there. Client-side <Link> navigations with a hash are
 * handled by Next's router and never reach this (the effect runs on mount).
 */
export function ScrollToHash() {
  useEffect(() => {
    let id = "";
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return; // malformed percent-encoding — nothing sensible to scroll to
    }
    if (!id) return;
    document.getElementById(id)?.scrollIntoView();
  }, []);
  return null;
}
