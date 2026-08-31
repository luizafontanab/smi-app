import type { Database, Json } from "@/lib/db/types";
import { activationBlocked, BILLING_MODES, MEMBER_STATUSES, slugify, type MemberStatus } from "@/lib/membership";
import { sanitizeRichText } from "@/lib/sanitize";
import { mergeSocial } from "@/lib/social";

/**
 * Console member editor: FormData → the payload to write to `members`.
 *
 * Kept free of Next and Supabase imports so it unit-tests with a bare FormData
 * — the server action around it ends in redirect(), which throws NEXT_REDIRECT
 * and cannot be exercised from vitest.
 */

type MemberUpdate = Database["public"]["Tables"]["members"]["Update"];

export type MemberFormExisting = {
  slug: string;
  status: MemberStatus;
  social: Json;
};

export type MemberFormResult =
  | { error: string }
  | { values: MemberUpdate; activatingDraft: boolean };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const nullable = (formData: FormData, key: string) => text(formData, key) || null;
const checked = (formData: FormData, key: string) => formData.get(key) === "on";

/**
 * Blank → null. Anything else must parse to a finite number inside `limit`:
 * lat/lng feed the OpenStreetMap bbox embed on the public profile, where a
 * out-of-range value renders a broken iframe rather than failing loudly.
 */
function coordinate(formData: FormData, key: string, limit: number): number | null | { error: string } {
  const raw = text(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) {
    return { error: `${key === "lat" ? "Latitude" : "Longitude"} must be a number between −${limit} and ${limit}.` };
  }
  return value;
}

/** `datetime-local` → ISO, so it round-trips through a timestamptz column. */
function timestamp(formData: FormData, key: string): string | null | { error: string } {
  const raw = text(formData, key);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { error: "Paid-at is not a valid date and time." };
  return parsed.toISOString();
}

export function memberValuesFromForm(
  formData: FormData,
  existing: MemberFormExisting,
  uploaded: { logo_path?: string | null; hero_path?: string | null } = {},
): MemberFormResult {
  const name = text(formData, "name");
  if (!name) return { error: "Company name is required." };

  // slug is `not null` and unique; fall back through the name to what's stored
  // rather than ever writing an empty string
  const slug = slugify(text(formData, "slug") || name) || existing.slug;

  const status = text(formData, "status") as MemberStatus;
  if (!MEMBER_STATUSES.includes(status)) return { error: "Unknown membership status." };

  const billing_mode = text(formData, "billing_mode");
  if (!BILLING_MODES.includes(billing_mode)) return { error: "Billing mode must be card or invoice." };

  const contact_email = nullable(formData, "contact_email");
  if (contact_email && !EMAIL_RE.test(contact_email)) return { error: "Contact email is not a valid address." };

  const lat = coordinate(formData, "lat", 90);
  if (lat && typeof lat === "object") return lat;
  const lng = coordinate(formData, "lng", 180);
  if (lng && typeof lng === "object") return lng;

  const paid_at = timestamp(formData, "paid_at");
  if (paid_at && typeof paid_at === "object") return paid_at;

  const comped_until = nullable(formData, "comped_until");

  const blocked = activationBlocked(existing, { status, paid_at, comped_until });
  if (blocked) return { error: blocked };

  // one line per testimonial — the only editor these have anywhere in the app
  const testimonials = text(formData, "testimonials")
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);

  // prefixed names: bare social keys would collide with `name` and `status`
  const social = mergeSocial(existing.social, (key) => String(formData.get(`social_${key}`) ?? ""));

  // Explicit allowlist, never a spread of the row: `search_tsv` is GENERATED
  // ALWAYS and Postgres rejects any write to it, but db/types.ts declares it
  // `search_tsv?: unknown` on Update — so TypeScript will not catch the mistake.
  const values: MemberUpdate = {
    name,
    slug,
    status,
    billing_mode,
    category_id: Number(formData.get("category_id")) || null,
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    address: nullable(formData, "address"),
    phone: nullable(formData, "phone"),
    website: nullable(formData, "website"),
    video_url: nullable(formData, "video_url"),
    contact_email,
    lat,
    lng,
    joined_at: nullable(formData, "joined_at"),
    grace_until: nullable(formData, "grace_until"),
    comped_until,
    paid_at,
    social,
    testimonials: testimonials as Json,
    // fulfilment tag only — see the neutrality note on the column's migration
    // and the source-grep test in tests/unit/adverts.test.ts
    is_bundle_account: checked(formData, "is_bundle_account"),
    ...(uploaded.logo_path ? { logo_path: uploaded.logo_path } : checked(formData, "remove_logo") ? { logo_path: null } : {}),
    ...(uploaded.hero_path ? { hero_path: uploaded.hero_path } : checked(formData, "remove_hero") ? { hero_path: null } : {}),
  };

  return { values, activatingDraft: existing.status === "draft" && status === "active" };
}

/** Field name for a social input, so the page and the parser cannot drift. */
export const socialFieldName = (key: string) => `social_${key}`;
