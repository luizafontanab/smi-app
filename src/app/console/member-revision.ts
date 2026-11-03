import type { Database, Json } from "@/lib/db/types";
import { slugify } from "@/lib/membership";
import { renderableHtml } from "@/lib/sanitize";
import { EMAIL_RE, parsePhone } from "@/lib/validate";
import { websiteUrl } from "@/lib/website-url";
import { youtubeId } from "@/lib/youtube";

/**
 * A member's pending page edit (`member_revisions.payload`) → what approving it
 * may write.
 *
 * The payload is member-authored and reachable without the dashboard: the
 * member_insert_revision policy (20260808000004) only checks member_id, so a
 * member with their session token could POST a revision straight to PostgREST
 * carrying `status`, `billing_mode`, `paid_at`, `is_bundle_account`,
 * `archived_at` — and decideRevision used to apply the payload wholesale on
 * Approve. Now only the fields the member's own form can produce are applied
 * (lib/member-form ownCompanyPageValuesFromForm, as submitted by dashboard
 * submitProfileEdit), each re-checked the way that parser checks it, and
 * anything else is reported back as ignored rather than written.
 *
 * Kept free of Next and Supabase imports, like member-form.ts, so it
 * unit-tests with a bare object; the console member page uses it too, to show
 * Jas exactly what Approve will change.
 */

type MemberUpdate = Database["public"]["Tables"]["members"]["Update"];

/** Every field ownCompanyPageValuesFromForm (the member's own save) writes, with the label Jas sees for it. */
export const REVISION_FIELD_LABELS = {
  name: "Company name",
  slug: "Web address",
  description: "Description",
  address: "Address",
  phone: "Phone",
  website: "Website",
  video_url: "Company video",
  contact_email: "Contact email",
  lat: "Latitude",
  lng: "Longitude",
  social: "Social links",
  logo_path: "Logo",
  hero_path: "Hero image",
} as const;

export type RevisionField = keyof typeof REVISION_FIELD_LABELS;

/** Not members columns: join tables the payload carries as id lists, applied separately. */
const SET_KEYS = ["service_ids", "membership_type_ids"] as const;

/**
 * Keys a revision can carry that are never applied, dropped silently.
 * - testimonials, category_id: written before a column was dropped
 *   (20260902000003 removed testimonials, 20260909000002 renamed category_id;
 *   both migrations scrubbed stored rows, this covers anything in between).
 * - industry_id, industry_ids: revisions submitted before 2 Nov, when members
 *   could still pick an industry. Industries are Jas's alone now, so approving
 *   an old revision must not overwrite the tags she has set since.
 * They're history, not tampering, so they aren't reported as ignored.
 */
const LEGACY_KEYS = new Set(["testimonials", "category_id", "industry_id", "industry_ids"]);

export type ParsedRevision = {
  /** Only allowlisted fields the payload actually carries, each validated. */
  values: MemberUpdate;
  /** null when the payload has no such key — "leave the set alone", not "clear it". */
  serviceIds: number[] | null;
  membershipTypeIds: number[] | null;
  /** Keys that were not applied, and why. */
  ignored: { key: string; reason: string }[];
};

const NOT_EDITABLE = "not something a member can change";
const nullableText = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === "string" ? v.trim() || null : undefined;
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * One allowlisted field → its value to write, or `undefined` when the payload's
 * value isn't one the member's form could have produced.
 */
function field(key: RevisionField, v: unknown, memberId: string): MemberUpdate[RevisionField] | undefined {
  switch (key) {
    case "name":
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    case "slug":
      return typeof v === "string" ? slugify(v) || undefined : undefined;
    case "description":
      // never apply unsanitised markup
      return typeof v === "string" ? renderableHtml(v) : undefined;
    case "address":
      return nullableText(v);
    case "website": {
      // As the form stores it (lib/website-url): an absolute http(s) link, or
      // nothing — never a javascript: or relative value slipped into the payload.
      const t = nullableText(v);
      return t == null ? t : websiteUrl(t) ?? undefined;
    }
    case "phone": {
      const t = nullableText(v);
      if (t == null) return t;
      const parsed = parsePhone(t);
      return typeof parsed === "string" ? parsed : undefined;
    }
    case "video_url": {
      const t = nullableText(v);
      return t == null || youtubeId(t) ? t : undefined;
    }
    case "contact_email": {
      const t = nullableText(v);
      return t == null || EMAIL_RE.test(t) ? t : undefined;
    }
    case "lat":
    case "lng": {
      const limit = key === "lat" ? 90 : 180;
      return v === null || (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit) ? v : undefined;
    }
    case "social": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
      const out: Record<string, string> = {};
      for (const [k, s] of Object.entries(v)) if (typeof s === "string" && s.trim()) out[k] = s.trim();
      return out as Json;
    }
    case "logo_path":
    case "hero_path":
      // Only a file this member uploaded through their own form (dashboard
      // submitProfileEdit uploads under members/<their id>/), or a removal —
      // never another member's logo or an arbitrary storage path.
      return v === null || (typeof v === "string" && new RegExp(`^members/${memberId}/[a-z0-9]+\\.[a-z0-9]+$`).test(v))
        ? v
        : undefined;
  }
}

function idList(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ids = v.map(Number);
  return ids.every(isPositiveInt) ? [...new Set(ids)] : undefined;
}

export function parseRevisionPayload(payload: unknown, memberId: string): ParsedRevision {
  const raw = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const values: Record<string, unknown> = {};
  const sets: Record<(typeof SET_KEYS)[number], number[] | null> = { service_ids: null, membership_type_ids: null };
  const ignored: ParsedRevision["ignored"] = [];

  for (const [key, v] of Object.entries(raw)) {
    if (LEGACY_KEYS.has(key)) continue;
    if ((SET_KEYS as readonly string[]).includes(key)) {
      const ids = idList(v);
      if (ids) sets[key as (typeof SET_KEYS)[number]] = ids;
      else ignored.push({ key, reason: "not a list of ids" });
      continue;
    }
    if (!Object.hasOwn(REVISION_FIELD_LABELS, key)) {
      ignored.push({ key, reason: NOT_EDITABLE });
      continue;
    }
    const value = field(key as RevisionField, v, memberId);
    if (value === undefined) ignored.push({ key, reason: "not a value the profile form produces" });
    else values[key] = value;
  }

  return {
    values: values as MemberUpdate,
    serviceIds: sets.service_ids,
    membershipTypeIds: sets.membership_type_ids,
    ignored,
  };
}

export type RevisionChange = { field: RevisionField; label: string; from: unknown; to: unknown };

/** The allowlisted fields whose proposed value differs from what the member has now, in form order. */
export function revisionChanges(values: MemberUpdate, current: Partial<Record<RevisionField, unknown>>): RevisionChange[] {
  // Key order is not a change: social links come back from jsonb re-sorted.
  const stable = (v: unknown): string =>
    v && typeof v === "object" && !Array.isArray(v)
      ? JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))))
      : JSON.stringify(v ?? null);
  const same = (a: unknown, b: unknown) => stable(a) === stable(b);
  return (Object.keys(REVISION_FIELD_LABELS) as RevisionField[])
    .filter((f) => Object.hasOwn(values, f) && !same(values[f], current[f]))
    .map((f) => ({ field: f, label: REVISION_FIELD_LABELS[f], from: current[f] ?? null, to: values[f] ?? null }));
}
