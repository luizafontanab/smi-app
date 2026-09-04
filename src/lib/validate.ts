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

/**
 * Blank → null. Otherwise a lenient phone shape: optional leading +, then
 * digits with spaces, hyphens or parentheses, 7–15 digits in total — loose
 * enough for "0161 555 0100" and "+44 (0)161 5550100", strict enough that the
 * stored value always yields a working `tel:` link (see app/go/[memberId]).
 */
export function parsePhone(raw: string): string | null | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (!/^\+?[\d()\s-]+$/.test(trimmed) || digits.length < 7 || digits.length > 15) {
    return { error: "Phone number can only contain digits, spaces, +, ( ) and -, with 7 to 15 digits." };
  }
  return trimmed;
}
