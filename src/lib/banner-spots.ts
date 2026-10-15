/**
 * How many banner spots we sell, sitewide. Banners carry no page and no
 * position: every live banner rotates through every banner position, and each
 * position cycles BANNERS_PER_POSITION of them per load (lib/adverts.ts).
 *
 * Shown against bookings on the console, never enforced — an over-sold month
 * is flagged, not blocked. Stored as a settings row (migration
 * 20261004000002), edited on Console → Adverts → Inventory.
 */
export const BANNER_SPOTS_KEY = "banner_spots";

/** What we sell when the row is missing or unreadable. */
export const DEFAULT_BANNER_SPOTS = 8;

/** The settings value is `{ count }`; anything else is the default, never zero. */
export function resolveBannerSpots(value: unknown): number {
  const count = (value as { count?: unknown } | null)?.count;
  return typeof count === "number" && Number.isInteger(count) && count >= 1 ? count : DEFAULT_BANNER_SPOTS;
}
