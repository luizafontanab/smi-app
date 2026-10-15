import type { AdvertFormat } from "@/lib/adverts";

/**
 * One source for the console's advert vocabulary.
 *
 * The format picker was copied verbatim into the artwork editor and the ad-spot
 * editor, and the phase labels into the bookings index and the booking detail —
 * with different casing, so the same booking read "upcoming" on one screen and
 * "Scheduled" on the next. Both lists live here now.
 */

export type AdvertFormatOption = { value: AdvertFormat; label: string };

/**
 * Sellable formats, in the order the pickers show them. Sizes match
 * AdCreative.tsx; the values mirror the adverts.format check constraint.
 *
 * `banner_narrow` (830×170) is deliberately ABSENT — it renders nowhere since
 * the grid homepage moved its second banner to the full-width `home_2` slot
 * (docs/HUMAN-TODO.md §14.5, fix-list 64), so nobody should be sold that size.
 * It stays allowed by the adverts.format CHECK constraint on purpose (existing
 * rows hold it, and the format may yet find a home), which is why this is a
 * UI-level hide, not a migration.
 */
export const ADVERT_FORMATS: AdvertFormatOption[] = [
  { value: "banner", label: "Banner (1280×170 desktop / 370×280 mobile)" },
  { value: "skyscraper", label: "Skyscraper (300×600, desktop only)" },
  { value: "mpu", label: "MPU (300×250)" },
  { value: "in_feed", label: "In-feed (native card)" },
  { value: "supplier_logo", label: "Supplier logo" },
  { value: "newsletter_banner", label: "Newsletter banner" },
  { value: "association_logo", label: "Association logo" },
];

/** Formats still held by existing rows but no longer offered. */
const RETIRED_FORMATS: Record<string, string> = {
  banner_narrow: "Banner — narrow (830×170) — retired, do not sell",
};

/**
 * The options a picker should render for a record whose current format is
 * `current`. A row already saved as a retired format keeps that option, or the
 * `<select>` would fall back to the first entry and silently rewrite the format
 * the next time someone saved an unrelated field.
 */
export function advertFormatOptions(current?: string | null): AdvertFormatOption[] {
  if (!current || ADVERT_FORMATS.some((f) => f.value === current)) return ADVERT_FORMATS;
  const label = RETIRED_FORMATS[current] ?? current.replace(/_/g, " ");
  return [...ADVERT_FORMATS, { value: current as AdvertFormat, label }];
}

/** What to call each phase returned by bookingPhase(). Lower case; screens that want caps apply CSS. */
export const PHASE_LABELS: Record<string, string> = {
  draft: "draft",
  awaiting: "awaiting approval",
  changes_needed: "changes needed",
  awaiting_payment: "awaiting payment",
  upcoming: "upcoming",
  live: "live",
  ended: "ended",
};
