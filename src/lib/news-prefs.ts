/**
 * Pure helpers for the /news personalization cookie and date filters.
 * Client-safe on purpose (no next/headers): RecordViewed.tsx imports the
 * cookie helpers, queries.ts and the /news page import the date validator.
 */

/** Category/industry slugs the reader has recently viewed, most-recent-first. */
export const VIEWED_CATS_COOKIE = "viewed_cats";
export const VIEWED_CATS_MAX = 5;
/** ~90 days, in seconds — the cookie is a soft preference, not an identity. */
export const VIEWED_CATS_MAX_AGE = 60 * 60 * 24 * 90;

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Parse a raw viewed_cats cookie value into a clean slug list.
 * Tolerates junk: URI-decodes, drops anything that isn't a slug, dedupes
 * (first occurrence wins — the list is most-recent-first) and caps the length.
 */
export function parseViewedCats(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // malformed percent-encoding — fall back to the raw string
  }
  const out: string[] = [];
  for (const part of decoded.split(",")) {
    const slug = part.trim().toLowerCase();
    if (!SLUG_RE.test(slug) || out.includes(slug)) continue;
    out.push(slug);
    if (out.length === VIEWED_CATS_MAX) break;
  }
  return out;
}

/**
 * Merge a page view's slugs into an existing cookie value: new slugs go to the
 * front (most-recent-first), deduped, capped. Returns the new cookie value.
 */
export function mergeViewedCats(existingRaw: string | null | undefined, slugs: string[]): string {
  const fresh = slugs.map((s) => s.trim().toLowerCase()).filter((s) => SLUG_RE.test(s));
  const merged: string[] = [];
  for (const slug of [...fresh, ...parseViewedCats(existingRaw)]) {
    if (!merged.includes(slug)) merged.push(slug);
    if (merged.length === VIEWED_CATS_MAX) break;
  }
  return merged.join(",");
}

/**
 * Validate a YYYY-MM-DD query param; anything malformed (wrong shape, month 13,
 * Feb 30 …) comes back undefined so the filter is silently ignored.
 */
export function parseDateParam(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return undefined;
  return v;
}
