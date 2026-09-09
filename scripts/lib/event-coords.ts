/**
 * Authored coordinates for seeded events, so the /event map has pins.
 *
 * The WordPress export never carried event coordinates, and the app only
 * geocodes a location when someone saves an event through the console —
 * Nominatim's usage policy rules out looking up a whole table's worth
 * (`20260903000002_event_coords.sql`: "never bulk, never at render"). That
 * constraint is about systematic mass lookups, not about a couple of values:
 * these two were resolved once, by hand, with the same identifying User-Agent
 * the app uses, and the results pasted here.
 *
 * Keeping them as data means the seed itself makes no network calls and stays
 * offline-reproducible. Imported events not listed here simply get no pin,
 * exactly as before — see docs/GO-LIVE.md §3.1.
 */
export const AUTHORED_EVENT_COORDS: Record<string, { lat: number; lng: number }> = {
  // Sutton Coldfield, B75 6LN
  "sheet-metal-industries-golf-challenge-2026": { lat: 52.5830999, lng: -1.8122883 },
  // Hannover, 30521, Germany
  "euroblech-2026": { lat: 52.3744779, lng: 9.7385532 },
};
