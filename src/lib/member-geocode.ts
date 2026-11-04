import { geocodeAddress } from "@/lib/adapters/geocode";

type Coords = { lat: number | null; lng: number | null };
export type Geocoder = (address: string) => Promise<{ lat: number; lng: number } | null>;

/**
 * Where a member's map pin comes from, for both editors of the same page.
 *
 * The shared `CompanyPageForm` carries latitude and longitude, so typed
 * coordinates always win — a member or operator who entered them deliberately
 * must not have them overwritten. Empty means "work it out from the address",
 * and only when the address actually changed: a fresh Nominatim lookup on every
 * unrelated save would be wasteful and against its usage policy.
 *
 * A failed lookup keeps whatever was already on file rather than blanking the
 * map. That is the safe direction — losing a working pin because a third-party
 * geocoder had a bad minute is a much worse outcome than a slightly stale one.
 *
 * Lives in its own module because `member-form.ts` is deliberately free of
 * imports that reach the network, so it can be unit-tested with a bare FormData.
 *
 * Also the rule for an event's map pin (lib/content-intake), with the event's
 * location as the address and the geocoder injected.
 */
export async function resolveCoordinates(
  submitted: Coords,
  existing: { address: string | null; lat: number | null; lng: number | null },
  address: string,
  geocode: Geocoder = geocodeAddress,
): Promise<Coords> {
  if (submitted.lat != null || submitted.lng != null) return submitted;

  const kept: Coords = { lat: existing.lat, lng: existing.lng };
  if (!address.trim() || address.trim() === (existing.address ?? "").trim()) return kept;

  const geocoded = await geocode(address);
  return geocoded ? { lat: geocoded.lat, lng: geocoded.lng } : kept;
}
