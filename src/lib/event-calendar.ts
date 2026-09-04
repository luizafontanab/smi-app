/**
 * Pure helpers for the public /event calendar. Bucketing lives here (testable
 * without a DOM); rendering stays in EventsCalendar.
 *
 * Multi-day events (ends_on set) are bucketed on their start day only — one
 * chip on the day it opens rather than a bar across the span. The chip's
 * title/date range on the event page carry the full duration; painting every
 * spanned cell would crowd a grid whose cells already hold several chips.
 */

export type CalendarEvent = {
  slug: string;
  title: string;
  /** date column — already a local YYYY-MM-DD string, so it IS the bucket key */
  starts_on: string;
  /** time column, HH:MM:SS */
  starts_time: string | null;
  ends_on: string | null;
  type: string | null;
};

/** starts_on → that day's events, timed ones sorted first-to-last (untimed lead). */
export function bucketEventsByDay<T extends Pick<CalendarEvent, "starts_on" | "starts_time">>(events: T[]): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const event of events) {
    const bucket = byDay.get(event.starts_on);
    if (bucket) bucket.push(event);
    else byDay.set(event.starts_on, [event]);
  }
  for (const bucket of byDay.values()) {
    bucket.sort((a, b) => (a.starts_time ?? "").localeCompare(b.starts_time ?? ""));
  }
  return byDay;
}
