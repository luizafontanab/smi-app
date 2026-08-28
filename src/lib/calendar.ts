/**
 * Month-grid date math shared by the console's story and video calendar views.
 * Pure and content-agnostic — bucketing/rendering stays in each caller.
 */

/** Local YYYY-MM-DD — the bucket key. Not toISOString, which would shift a
 *  late-evening item into the next day whenever the server is behind UTC. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** `YYYY-MM` → first of that month, falling back to the current month. */
export function parseMonth(value: string | undefined): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  return new Date(Number(m[1]), month - 1, 1);
}

/**
 * The cells the grid draws, Mon-first: whole weeks from the one containing the
 * 1st to the one containing the last day — 5 rows most months, 6 when the month
 * straddles them. `start`/`end` bound the DB query, so the leading and trailing
 * cells borrowed from the neighbouring months get filled too.
 */
export function monthGrid(month: Date) {
  const lead = (month.getDay() + 6) % 7; // Mon = 0
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - lead);
  const days = Array.from({ length: cells }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + cells), days };
}

export const shiftMonth = (month: Date, by: number) => new Date(month.getFullYear(), month.getMonth() + by, 1);

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
