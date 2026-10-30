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

/**
 * The UK postcode in a free-text address, normalised ("tf1 6ah" → "TF1 6AH"),
 * or null. Imported addresses often carry a company name, a unit number and a
 * doubled comma ahead of the street, which Nominatim's free-text search can't
 * place — but the postcode alone it nearly always can, to within a street.
 */
export function ukPostcode(address: string): string | null {
  // Case-insensitive because imported postcodes are often lowercase ("cv34rs").
  // That also lets "Unit B2 3rd Floor" look like "B2 3RD", so: an ordinal
  // ("3rd", "2nd") followed by another word is a floor or a street, not an
  // incode; and of what's left the last wins — a UK address ends with its postcode.
  const candidates = [...address.matchAll(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b(?=(\s+[A-Z])?)/gi)]
    .filter((m) => !(m[3] && /^\d(st|nd|rd|th)$/i.test(m[2])));
  const m = candidates.at(-1);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}

/** A UK postcode → its coordinates, via Nominatim's structured search. Same failure rules as geocodeAddress. */
export async function geocodePostcode(postcode: string): Promise<Coordinates | null> {
  const trimmed = postcode.trim();
  if (!trimmed) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&postalcode=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, { headers: { "User-Agent": "SMI-app (https://sheetmetalindustries.com)" } });
    if (!res.ok) return null;
    const first = ((await res.json()) as NominatimResult[])[0];
    if (!first) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}
