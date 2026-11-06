/**
 * Europe/London wall-clock time, for `datetime-local` inputs and anything
 * that means "a time of day in the UK".
 *
 * A `datetime-local` value ("2026-07-01T10:00") carries no zone. `new Date()`
 * reads it in the *server's* zone — UTC on Vercel — so a London editor
 * scheduling 10:00 in summer got 11:00, and the input showed the stored UTC
 * time back to them. Everything here is pinned to Europe/London instead, so
 * it gives the same answer on any machine. Intl only, no dependency.
 */

const ZONE = "Europe/London";

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

function wall(at: Date): Wall {
  const p: Record<string, number> = {};
  for (const part of PARTS.formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/** London's offset from UTC at an instant, in ms (0 in GMT, 3 600 000 in BST). */
function offsetAt(at: Date): number {
  const w = wall(at);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant London's clocks read y-mo-d h:mi. See parseLondonInput for the clock-change rules. */
function fromWall(y: number, mo: number, d: number, h: number, mi: number): Date {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // The offset either side of this wall time. Equal on every ordinary day.
  const before = offsetAt(new Date(asUtc - 3 * 3_600_000));
  const after = offsetAt(new Date(asUtc + 3 * 3_600_000));
  // Repeated hour in October: both readings are valid; take the earlier (BST)
  // one. In the skipped hour in March neither reading lands back on this wall
  // time; asUtc - before (GMT) is then the instant an hour later on the clock,
  // which is "moves forward".
  const first = new Date(asUtc - Math.max(before, after));
  const w = wall(first);
  if (w.h === h && w.mi === mi && w.d === d) return first;
  return new Date(asUtc - Math.min(before, after));
}

const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * A `datetime-local` value read as London time. Null when it isn't one.
 * A time skipped when the clocks go forward moves forward an hour; a time
 * that happens twice when they go back is the first (BST) one.
 */
export function parseLondonInput(value: string): Date | null {
  const m = INPUT.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  // Reject 31 Feb and friends rather than letting Date.UTC roll them over.
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;
  return fromWall(y, mo, d, h, mi);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A stored instant as a `datetime-local` defaultValue in London time; "" for none. */
export function londonInputValue(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const w = wall(at);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`;
}

/** "Wed 1 Jul 2026, 10:00" in London time. */
export function formatLondon(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A compact UK time for a status line: "5 Nov 15:00". Given `now`, a time on
 * the same London day is just "15:00" — for something still to come. No
 * weekday or year: these lines sit next to dates days, not years, apart.
 */
export function formatLondonShort(iso: string | Date, now?: Date): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: ZONE, day: "numeric", month: "short" });
  return now && day(at) === day(now) && at.getFullYear() === now.getFullYear() ? time : `${day(at)} ${time}`;
}

/** Midnight London time at the start of the London day containing `at`. */
export function londonDayStart(at: Date): Date {
  const w = wall(at);
  return fromWall(w.y, w.mo, w.d, 0, 0);
}

/** `hh:mm` London time, `days` London days after the one containing `at`. */
export function londonAt(at: Date, days: number, hh: number, mm = 0): Date {
  const w = wall(at);
  // Step on the calendar date, not by 24h, so a clock change in between can't shift it.
  const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + days));
  return fromWall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm);
}
