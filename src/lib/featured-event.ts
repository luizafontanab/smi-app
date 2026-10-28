/**
 * Shared by the Featured Event read (queries.ts featuredEvent()) and its
 * console actions, so the settings key and the "is it over" rule can't drift.
 */

/** settings key for the event the homepage's top card falls back to when nothing is booked. */
export const FEATURED_EVENT_BACKUP_KEY = "featured_event_backup";

/** Why the top card shows the event it does. */
export type FeaturedEventSource = "booked" | "backup" | "fallback";

/** An event's last day: ends_on for a multi-day event, starts_on otherwise. */
export const eventLastDay = (e: { starts_on: string; ends_on: string | null }) => e.ends_on ?? e.starts_on;
