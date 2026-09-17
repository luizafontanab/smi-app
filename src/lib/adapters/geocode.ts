/**
 * Address → lat/lng, via Nominatim (OpenStreetMap's free search API — no key,
 * GAPS A4.5). Called once per profile save, never on keystroke, per
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 * an identifying User-Agent and at most one request per save.
 *
 * Failure is never fatal to a profile save — a member typing an address that
 * doesn't resolve should still get their other edits saved, just without a
 * map pin this time.
 */

export type Coordinates = { lat: number; lng: number };

type NominatimResult = { lat: string; lon: string };

export async function geocodeAddress(address: string): Promise<Coordinates | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, { headers: { "User-Agent": "SMI-app (https://sheetmetalindustries.com)" } });
    if (!res.ok) return null;
    const results = (await res.json()) as NominatimResult[];
    const first = results[0];
    if (!first) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
