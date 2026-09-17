"use client";

import { useEffect } from "react";
import { CONSENT_COOKIE } from "@/lib/consent";
import { mergeViewedCats, VIEWED_CATS_COOKIE, VIEWED_CATS_MAX_AGE } from "@/lib/news-prefs";

/**
 * Invisible mount on the story page: notes which category/industry slugs the
 * reader just viewed in the `viewed_cats` cookie, which feeds the /news
 * "For you" rail.
 *
 * Consent-gated the same way analytics is (analyticsConsented in
 * lib/analytics.ts): the site's model is affirmative — only an explicit
 * smi-consent=all enables non-essential cookies; "essential" and the absent
 * cookie (banner still up) both mean no. A personalization cookie is not
 * essential, so it follows the same gate.
 */
export function RecordViewed({ slugs }: { slugs: string[] }) {
  // join() so the effect keys on content, not on a per-render array identity
  const joined = slugs.join(",");
  useEffect(() => {
    if (!joined) return;
    const jar = document.cookie.split("; ");
    if (!jar.includes(`${CONSENT_COOKIE}=all`)) return;
    const existing = jar.find((c) => c.startsWith(`${VIEWED_CATS_COOKIE}=`))?.slice(VIEWED_CATS_COOKIE.length + 1);
    const next = mergeViewedCats(existing, joined.split(","));
    if (!next) return;
    document.cookie = `${VIEWED_CATS_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${VIEWED_CATS_MAX_AGE}; SameSite=Lax`;
  }, [joined]);
  return null;
}
