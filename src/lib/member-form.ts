import type { Database, Json } from "@/lib/db/types";
import { activationBlocked, BILLING_MODES, MEMBER_STATUSES, slugify, type MemberStatus } from "@/lib/membership";
import { sanitizeRichText } from "@/lib/sanitize";
import { mergeSocial } from "@/lib/social";
import { industryIdsFromForm, resolveIndustryPick } from "@/lib/member-services";
import { EMAIL_RE, parseCoordinate, parsePhone } from "@/lib/validate";
import { optionalYoutubeUrl } from "@/lib/youtube";
import { websiteUrl } from "@/lib/website-url";
import { parseLondonInput } from "@/lib/london-time";

/**
 * FormData → the payload to write to `members`, for both editors of the same
 * company page: the console's `/console/members/[id]` and the member's own
 * `/dashboard/profile`.
 *
 * Split in two deliberately. `companyPageValuesFromForm` parses the fields the
 * shared `CompanyPageForm` renders — the ones a member may change about their
 * own page. `memberValuesFromForm` wraps it and adds the admin-only membership
 * half (status, billing, payment dates), which only the console ever submits.
 * One parser for one form: before this split the two pages had drifted, most
 * visibly on the social inputs, where the console posted `social_linkedin` and
 * the member page posted `linkedin`.
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

/**
 * `industryIds` is the member's full industry set, already reconciled with the
 * primary in `values.industry_id` (resolveIndustryPick). It is not a members
 * column — the caller writes it to `member_industries`, or into a revision.
 */
export type CompanyPageResult = { error: string } | { values: MemberUpdate; industryIds: number[] };

export type MemberFormResult =
  | { error: string }
  | { values: MemberUpdate; industryIds: number[]; activatingDraft: boolean };

/** Said for a Website field that holds something, but not a web address. */
export const WEBSITE_INVALID = "Website isn't a valid web address — use something like www.example.co.uk.";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const nullable = (formData: FormData, key: string) => text(formData, key) || null;
const checked = (formData: FormData, key: string) => formData.get(key) === "on";

const coordinate = (formData: FormData, key: "lat" | "lng", limit: number) => parseCoordinate(text(formData, key), limit, key);

/** `datetime-local`, read as UK time (GAPS A3.9) → ISO, so it round-trips through a timestamptz column. */
function timestamp(formData: FormData, key: string): string | null | { error: string } {
  const raw = text(formData, key);
  if (!raw) return null;
  const parsed = parseLondonInput(raw);
  if (!parsed) return { error: "Paid-at is not a valid date and time." };
  return parsed.toISOString();
}

/**
 * The shared half: everything `CompanyPageForm` renders, and nothing a member
 * must not be able to set. Both actions run this on the same field names, so
 * the two pages cannot drift apart again.
 */
export function companyPageValuesFromForm(
  formData: FormData,
  existing: MemberFormExisting,
  uploaded: { logo_path?: string | null; hero_path?: string | null } = {},
): CompanyPageResult {
  return parseCompanyPage(formData, existing, uploaded, true) as CompanyPageResult;
}

/**
 * The member's own /dashboard/profile save. Same fields minus industries:
 * members never see or set an industry — only Jas does, in the console. Any
 * industry fields a crafted form posts are ignored, and `values` carries no
 * `industry_id`, so a save can't change or clear what Jas set.
 */
export function ownCompanyPageValuesFromForm(
  formData: FormData,
  existing: MemberFormExisting,
  uploaded: { logo_path?: string | null; hero_path?: string | null } = {},
): { error: string } | { values: MemberUpdate } {
  return parseCompanyPage(formData, existing, uploaded, false);
}

function parseCompanyPage(
  formData: FormData,
  existing: MemberFormExisting,
  uploaded: { logo_path?: string | null; hero_path?: string | null },
  withIndustries: boolean,
): { error: string } | { values: MemberUpdate; industryIds?: number[] } {
  const name = text(formData, "name");
  if (!name) return { error: "Company name is required." };

  // slug is `not null` and unique; fall back through the name to what's stored
  // rather than ever writing an empty string
  const slug = slugify(text(formData, "slug") || name) || existing.slug;

  const contact_email = nullable(formData, "contact_email");
  if (contact_email && !EMAIL_RE.test(contact_email)) return { error: "Contact email is not a valid address." };

  const lat = coordinate(formData, "lat", 90);
  if (lat && typeof lat === "object") return lat;
  const lng = coordinate(formData, "lng", 180);
  if (lng && typeof lng === "object") return lng;

  const industries = withIndustries
    ? resolveIndustryPick(industryIdsFromForm(formData), Number(formData.get("industry_id")) || null)
    : null;
  if (industries && "error" in industries) return industries;

  const phone = parsePhone(text(formData, "phone"));
  if (phone && typeof phone === "object") return phone;

  // Stored as a real link: "www.foo.co.uk" gains https:// (lib/website-url).
  // Something typed that can't be one is refused rather than saved as nothing,
  // which used to wipe the member's website without a word; blank stays blank.
  const typedWebsite = text(formData, "website");
  const website = websiteUrl(typedWebsite);
  if (typedWebsite && !website) return { error: WEBSITE_INVALID };

  // YouTube only, like every other video field (USE-CASES gap 23, GAPS A8.5):
  // anything else never played — it just vanished from the page.
  const video = optionalYoutubeUrl(formData.get("video_url"));
  if ("error" in video) return { error: `Company video: ${video.error}` };

  // prefixed names: bare social keys would collide with `name` and `status`
  const social = mergeSocial(existing.social, (key) => String(formData.get(socialFieldName(key)) ?? ""));

  // Explicit allowlist, never a spread of the row: `search_tsv` is GENERATED
  // ALWAYS and Postgres rejects any write to it, but db/types.ts declares it
  // `search_tsv?: unknown` on Update — so TypeScript will not catch the mistake.
  const values: MemberUpdate = {
    name,
    slug,
    ...(industries ? { industry_id: industries.primaryId } : {}),
    description: sanitizeRichText(String(formData.get("description") ?? "")),
    address: nullable(formData, "address"),
    phone,
    website,
    video_url: video.url,
    contact_email,
    lat,
    lng,
    social,
    ...(uploaded.logo_path ? { logo_path: uploaded.logo_path } : checked(formData, "remove_logo") ? { logo_path: null } : {}),
    ...(uploaded.hero_path ? { hero_path: uploaded.hero_path } : checked(formData, "remove_hero") ? { hero_path: null } : {}),
  };

  return industries ? { values, industryIds: industries.industryIds } : { values };
}

/**
 * Console member editor: the shared company-page fields plus the membership
 * half no member ever submits.
 */
export function memberValuesFromForm(
  formData: FormData,
  existing: MemberFormExisting,
  uploaded: { logo_path?: string | null; hero_path?: string | null } = {},
): MemberFormResult {
  const shared = companyPageValuesFromForm(formData, existing, uploaded);
  if ("error" in shared) return shared;

  const status = text(formData, "status") as MemberStatus;
  if (!MEMBER_STATUSES.includes(status)) return { error: "Unknown membership status." };

  const billing_mode = text(formData, "billing_mode");
  if (!BILLING_MODES.includes(billing_mode)) return { error: "Billing mode must be card or invoice." };

  const paid_at = timestamp(formData, "paid_at");
  if (paid_at && typeof paid_at === "object") return paid_at;

  const comped_until = nullable(formData, "comped_until");

  const blocked = activationBlocked(existing, { status, paid_at, comped_until });
  if (blocked) return { error: blocked };

  const values: MemberUpdate = {
    ...shared.values,
    status,
    billing_mode,
    joined_at: nullable(formData, "joined_at"),
    grace_until: nullable(formData, "grace_until"),
    comped_until,
    paid_at,
    // fulfilment tag only — see the neutrality note on the column's migration
    // and the source-grep test in tests/unit/adverts.test.ts
    is_bundle_account: checked(formData, "is_bundle_account"),
  };

  return { values, industryIds: shared.industryIds, activatingDraft: existing.status === "draft" && status === "active" };
}

/** Field name for a social input, so the page and the parser cannot drift. */
export const socialFieldName = (key: string) => `social_${key}`;
