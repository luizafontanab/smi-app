/**
 * How many Featured Member slots are left in each of the coming months —
 * what a member sees on the Buy page before asking for one.
 *
 * Counted exactly as saveFeaturedMemberPlacement counts its cap
 * (src/app/console/actions.ts): every featured_member placement whose dates
 * touch the month, held-for-payment ones included. So "3 left" means the
 * console would accept three more whole-month bookings. A month with a gap
 * partway through can still read as full — the console check is whole-term too.
 *
 * featuredMonths is pure; loadFeaturedMonths fetches dates only — never whose they are.
 */
import { parseMonth, shiftMonth } from "./calendar";
import { FEATURED_SLOTS } from "./pricing";
import type { serviceDb } from "./db/server";

export const FEATURED_MONTHS_AHEAD = 12;

export type FeaturedMonth = {
  /** YYYY-MM — the value the Buy form submits. */
  key: string;
  /** YYYY-MM-01 */
  first: string;
  /** Last day of the month, YYYY-MM-DD. */
  last: string;
  /** e.g. "November 2026". */
  label: string;
  left: number;
};

type Run = { starts_on: string; ends_on: string };

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** `YYYY-MM-01` (a stored preferred_month) → "November 2026". */
export const monthLabel = (first: string) =>
  new Date(`${first.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** `YYYY-MM-01` → that month's last day, `YYYY-MM-DD`. */
export const monthLast = (first: string) =>
  ymd(new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0, 12)));

/** The months a member can choose from, this UK month first. Calendar-day Dates are noon UTC (calendar.ts). */
export function featuredMonths(runs: Run[], now = new Date(), count = FEATURED_MONTHS_AHEAD): FeaturedMonth[] {
  const start = parseMonth(undefined, now);
  return Array.from({ length: count }, (_, i) => {
    const first = ymd(shiftMonth(start, i));
    const last = monthLast(first);
    const taken = runs.filter((r) => r.starts_on <= last && r.ends_on >= first).length;
    return {
      key: first.slice(0, 7),
      first,
      last,
      label: monthLabel(first),
      left: Math.max(0, FEATURED_SLOTS.cap - taken),
    };
  });
}

/** The window's date bounds, for the placements query: anything touching it. */
export function featuredWindow(now = new Date(), count = FEATURED_MONTHS_AHEAD) {
  const months = featuredMonths([], now, count);
  return { from: months[0].first, to: months[months.length - 1].last };
}

/**
 * The months, counted against the live placements. Shared by the Buy page and
 * requestVisibility's re-check so the two can't count differently.
 */
export async function loadFeaturedMonths(db: ReturnType<typeof serviceDb>, now = new Date()): Promise<FeaturedMonth[]> {
  const { from, to } = featuredWindow(now);
  const { data, error } = await db
    .from("placements")
    .select("starts_on, ends_on")
    .eq("kind", "featured_member")
    .lte("starts_on", to)
    .gte("ends_on", from);
  if (error) throw new Error(`featured availability: ${error.message}`);
  return featuredMonths(data ?? [], now);
}
