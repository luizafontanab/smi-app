/**
 * Pure helpers for the console analytics page: the date range, the matching
 * previous period, % change and paging. Kept apart from the page so they can
 * be unit-tested without rendering it.
 *
 * Days are Europe/London calendar days, written YYYY-MM-DD. The range is
 * inclusive of both ends; the SQL bounds are [from 00:00, to+1 00:00) London.
 */

export const DEFAULT_DAYS = 28;
export const PRESETS = [7, 28, 90] as const;
const MAX_DAYS = 366;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type DayRange = { from: string; to: string; days: number };

/** Today's date in London, as YYYY-MM-DD. */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive count of days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
}

/**
 * Reads ?days= (a preset) or ?from=&to= from the URL. Anything unusable falls
 * back to the last DEFAULT_DAYS days. Reversed dates are swapped, future dates
 * are pulled back to today, and the span is capped at a year.
 */
export function parseRange(sp: { from?: unknown; to?: unknown; days?: unknown }, today: string): DayRange {
  const preset = Number(sp.days);
  if (PRESETS.includes(preset as (typeof PRESETS)[number])) {
    return { from: addDays(today, -(preset - 1)), to: today, days: preset };
  }
  if (isDay(sp.from) && isDay(sp.to)) {
    let [from, to] = sp.from <= sp.to ? [sp.from, sp.to] : [sp.to, sp.from];
    if (to > today) to = today;
    if (from > today) from = today;
    if (daysBetween(from, to) > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
    return { from, to, days: daysBetween(from, to) };
  }
  return { from: addDays(today, -(DEFAULT_DAYS - 1)), to: today, days: DEFAULT_DAYS };
}

/** The period of the same length that ends the day before `range` starts. */
export function previousRange(range: DayRange): DayRange {
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(range.days - 1)), to, days: range.days };
}

/** Bounds for site_stats(): Postgres reads the zone name, so DST is handled there. */
export function sqlBounds(range: DayRange): { p_from: string; p_to: string } {
  return { p_from: `${range.from} 00:00:00 Europe/London`, p_to: `${addDays(range.to, 1)} 00:00:00 Europe/London` };
}

/** % change from `previous` to `current`; null when there is no baseline to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

export type Page<T> = { rows: T[]; page: number; pages: number; start: number; end: number; total: number };

/** 1-based paging; an out-of-range page is clamped rather than shown empty. */
export function paginate<T>(items: T[], page: unknown, size = 10): Page<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const n = Math.min(Math.max(1, Math.floor(Number(page)) || 1), pages);
  const startIdx = (n - 1) * size;
  const rows = items.slice(startIdx, startIdx + size);
  return { rows, page: n, pages, start: total ? startIdx + 1 : 0, end: startIdx + rows.length, total };
}

export type SiteStats = {
  views: number;
  users: number;
  new_users: number;
  sessions: number;
  top_pages: { path: string; views: number }[];
  sources: { source: string; users: number }[];
  devices: { device: string; users: number }[];
  countries: { country: string; users: number }[];
  daily: { day: string; views: number }[];
};

const EMPTY: SiteStats = { views: 0, users: 0, new_users: 0, sessions: 0, top_pages: [], sources: [], devices: [], countries: [], daily: [] };

/** The RPC returns untyped JSON; anything missing reads as zero or empty rather than crashing the page. */
export function toSiteStats(json: unknown): SiteStats {
  if (!json || typeof json !== "object") return EMPTY;
  const o = json as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  const arr = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
  return {
    views: num(o.views),
    users: num(o.users),
    new_users: num(o.new_users),
    sessions: num(o.sessions),
    top_pages: arr(o.top_pages),
    sources: arr(o.sources),
    devices: arr(o.devices),
    countries: arr(o.countries),
    daily: arr(o.daily),
  };
}

export function sessionsPerUser(s: SiteStats): number {
  return s.users ? s.sessions / s.users : 0;
}

/** Looks up a row's previous-period value by key, for per-row % change. */
export function indexBy<T>(rows: T[], key: (r: T) => string, value: (r: T) => number): Map<string, number> {
  return new Map(rows.map((r) => [key(r), value(r)] as const));
}
