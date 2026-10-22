/**
 * Month-grid date math shared by the console's calendar views (stories,
 * videos, newsletter, events, Command Centre) and the public /event calendar.
 * Pure and content-agnostic — bucketing/rendering stays in each caller.
 *
 * GAPS A3.9: everything here is UK days, whatever the server's zone (UTC on
 * Vercel). It used to bucket by the server's local day, so in summer an item
 * at 00:30 UK time sat on the day before, and the query bounds were UTC
 * midnights.
 *
 * Two kinds of Date pass through:
 *   - instants (a story's publish time): `dayKey` / `monthKey` read the UK
 *     calendar day they fall on;
 *   - calendar days (the grid's cells, `parseMonth`'s month): noon UTC on that
 *     date. Noon is the same date in the UK and on any server within ±11 hours
 *     of UTC, so `getDate()`, `getMonth()` and a zone-less `toLocaleDateString`
 *     in the views keep working unchanged, and `dayKey` reads them as that date.
 */
import { londonDayStart } from "./london-time";

const ZONE = "Europe/London";

const YMD = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The UK calendar date an instant falls on, as [year, month 1–12, day]. */
function ukDate(d: Date): [number, number, number] {
  const p: Record<string, number> = {};
  for (const part of YMD.formatToParts(d)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return [p.year, p.month, p.day];
}

/** A calendar day, as noon UTC on that date (see above). */
const calendarDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));

/** UK YYYY-MM-DD — the bucket key. Also the date-column bound for a grid's `start`/`end`. */
export const dayKey = (d: Date) => {
  const [y, m, day] = ukDate(d);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const monthKey = (d: Date) => dayKey(d).slice(0, 7);

/** This UK month's 1st. */
function thisMonth(now = new Date()): Date {
  const [y, m] = ukDate(now);
  return calendarDay(y, m, 1);
}

/** `YYYY-MM` → first of that month, falling back to the current UK month. */
export function parseMonth(value: string | undefined, now = new Date()): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return thisMonth(now);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return thisMonth(now);
  return calendarDay(Number(m[1]), month, 1);
}

/**
 * The cells the grid draws, Mon-first: whole weeks from the one containing the
 * 1st to the one containing the last day — 5 rows most months, 6 when the month
 * straddles them. `start`/`end` bound the DB query, so the leading and trailing
 * cells borrowed from the neighbouring months get filled too: they are the
 * instants UK midnight starts the first cell and the day after the last
 * (`dayKey` of either gives the date, for date columns).
 */
export function monthGrid(month: Date) {
  const [y, m] = ukDate(month);
  const first = calendarDay(y, m, 1);
  const lead = (first.getUTCDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const days = Array.from({ length: cells }, (_, i) => calendarDay(y, m, 1 - lead + i));
  const after = calendarDay(y, m, 1 - lead + cells);
  return { start: londonDayStart(days[0]), end: londonDayStart(after), days };
}

export const shiftMonth = (month: Date, by: number) => {
  const [y, m] = ukDate(month);
  return calendarDay(y, m + by, 1);
};

/** A time of day on a calendar, in UK time. */
export const ukTime = (at: Date) => at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: ZONE });

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
