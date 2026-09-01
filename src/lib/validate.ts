/**
 * Field validators shared between the console member editor
 * (`lib/member-form.ts`) and the self-service profile form
 * (`app/dashboard/actions.ts`) — split out so the two forms can't drift on
 * what counts as a valid email or coordinate.
 */

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A redirect target we are willing to pass to `redirect()`: same-origin
 * pathname only. Anything absolute (`https://…`), protocol-relative (`//…`)
 * or backslash-tricked (`/\…`, treated as protocol-relative by browsers) is
 * rejected — a `?next=` that survives this cannot take the user off-site.
 */
export function safeInternalPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

/**
 * Blank → null. Anything else must parse to a finite number inside `limit`:
 * lat/lng feed the OpenStreetMap bbox embed on the public profile, where an
 * out-of-range value renders a broken iframe rather than failing loudly.
 */
export function parseCoordinate(raw: string, limit: number, label: "lat" | "lng"): number | null | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || Math.abs(value) > limit) {
    return { error: `${label === "lat" ? "Latitude" : "Longitude"} must be a number between −${limit} and ${limit}.` };
  }
  return value;
}
