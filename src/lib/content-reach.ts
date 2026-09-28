/**
 * Content reach (GAPS A9.2, USE-CASES Gap 6 as refined 18 Sep): one overall
 * figure across the kinds of content a member has on SMI, broken out by type.
 * All-time and cumulative by design — Gap 6's rule that the number "can never
 * drop" — and every part is a real, measured count, never an estimate.
 *
 * Social shares are the fourth part the call named. There is no measurement
 * for them yet (how "social media reach" is counted is open — GAPS D5), so
 * they are left out rather than shown as zero.
 */

/** Video views are only attributable from the day `video_view` shipped (20260928000003). */
export const VIDEO_VIEWS_SINCE = "28 September 2026";

/** Month-by-month sum of several aligned series (e.g. an advert chart's locations). */
export function sumSeries(series: { values: number[] }[]): number[] {
  const length = Math.max(0, ...series.map((s) => s.values.length));
  return Array.from({ length }, (_, i) => series.reduce((total, s) => total + (s.values[i] ?? 0), 0));
}

export type ReachPart = { label: string; total: number };

/** The headline and its breakdown. Parts keep their order; the total is their sum. */
export function contentReach(parts: ReachPart[]): { total: number; parts: ReachPart[] } {
  return { total: parts.reduce((sum, p) => sum + p.total, 0), parts };
}
