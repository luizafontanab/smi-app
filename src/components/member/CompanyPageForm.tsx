import Image from "next/image";
import { socialFieldName } from "@/lib/member-form";
import { renderableHtml } from "@/lib/sanitize";
import { SOCIAL_CHANNELS } from "@/lib/social";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ServicesPicker } from "@/components/member/ServicesPicker";
import { MAX_MEMBERSHIP_TYPES } from "@/lib/member-services";
import type { UploadResult } from "@/lib/upload-limits";
import { UploadField } from "@/components/UploadField";

// text-base: under 16px, iOS zooms the page when a field is tapped (#33 M2).
const field = "mt-1 w-full rounded border px-3 py-2 text-base";
const label = "text-sm font-medium";
// #33 M17: the form is ~3,000px on a phone, so it is broken into headed groups,
// and the native 13px checkboxes grow to a tappable size on touch screens.
const groupHeading = "border-t pt-5 text-base font-bold text-ink";
const check = "h-4 w-4 shrink-0 accent-ink [@media(pointer:coarse)]:h-5 [@media(pointer:coarse)]:w-5";
const checkLabel = "flex items-center gap-2 py-1 text-sm";

export type CompanyPageMember = {
  name: string;
  slug: string;
  status: string;
  /** Console only — the member's own page never reads or shows it. */
  industry_id?: number | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  video_url: string | null;
  contact_email: string | null;
  lat: number | null;
  lng: number | null;
  logo_path: string | null;
  hero_path: string | null;
  social: unknown;
};

export type Taxonomy = { id: number; name: string };

/**
 * The company page, as one form — rendered identically at
 * `/console/members/[id]` and `/dashboard/profile`.
 *
 * The two pages are the same edit of the same row, so they share this and only
 * this. What differs is what sits *around* it: the console adds the membership,
 * payment, activity and approval panels below; the member page adds nothing.
 * Before this existed the two had drifted in ways nobody had noticed — the
 * social inputs posted different field names, only the console could clear a
 * logo, and only the member page could set Services.
 *
 * `mode` gates two things, neither cosmetic:
 *  - the slug confirmation — the console's operator ticks it deliberately; a
 *    member's rename is approval-gated anyway, so Jas is the confirmation;
 *  - industries — Jas's alone. Members never see or set them, and their save
 *    (ownCompanyPageValuesFromForm) ignores any industry field posted.
 *
 * Membership types used to be a second gate (read-only for members, decided
 * 13 Sep). The 18 Sep call reversed that — members pick their own, up to six
 * (USE-CASES gap 21, GAPS A8.1) — and on a live page the pick is approval-gated
 * like every other field here, so the gate is gone.
 */
export function CompanyPageForm({
  mode,
  member,
  industries,
  services,
  membershipTypes,
  selectedServiceIds,
  selectedMembershipTypeIds,
  selectedIndustryIds,
  uploadImage,
  logoUrl,
  heroUrl,
}: {
  mode: "console" | "member";
  member: CompanyPageMember;
  /** Console only; ignored in member mode. */
  industries?: Taxonomy[];
  services: Taxonomy[];
  membershipTypes: Taxonomy[];
  selectedServiceIds: Set<number>;
  selectedMembershipTypeIds: Set<number>;
  /** member_industries — every industry they are in, the primary included. Console only. */
  selectedIndustryIds?: Set<number>;
  uploadImage: (formData: FormData) => Promise<UploadResult>;
  logoUrl: string | null;
  heroUrl: string | null;
}) {
  const social = (member.social ?? {}) as Record<string, string>;
  const isDraft = member.status === "draft";
  const isConsole = mode === "console";
  // Industries are Jas's alone: never rendered on the member's own page.
  const consoleIndustries = isConsole ? industries : undefined;

  return (
    <fieldset className="space-y-4">
      <h2 className="text-base font-bold text-ink">Company and listing</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className={label}>Company name</label>
          <input id="name" name="name" defaultValue={member.name} required className={field} />
        </div>
        {consoleIndustries && (
          <div>
            <label htmlFor="industry_id" className={label}>Primary industry</label>
            <select id="industry_id" name="industry_id" defaultValue={member.industry_id ?? ""} className={field}>
              <option value="">— none —</option>
              {consoleIndustries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* A set plus a primary (migration 20261012000001): listed under every
          ticked industry, labelled with the primary. resolveIndustryPick
          reconciles the two on save. */}
      {consoleIndustries && (
        <fieldset>
          <legend className={label}>Industries</legend>
          <p className="text-xs text-graphite">
            They appear under every industry ticked here; the primary industry above is the one shown on their listing.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
            {consoleIndustries.map((i) => (
              <label key={i.id} className={checkLabel}>
                <input type="checkbox" className={check} name="industries" value={i.id} defaultChecked={selectedIndustryIds?.has(i.id) ?? false} />
                {i.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className={label}>Membership types</legend>
        <p className="text-xs text-graphite">
          Shown on the public directory as a filter — distinct from {consoleIndustries ? "Industries above, and from " : ""}the Services list.
          Tick every one that applies, up to {MAX_MEMBERSHIP_TYPES}.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
          {membershipTypes.map((t) => (
            <label key={t.id} className={checkLabel}>
              <input type="checkbox" className={check} name="membership_types" value={t.id} defaultChecked={selectedMembershipTypeIds.has(t.id)} />
              {t.name}
            </label>
          ))}
        </div>
      </fieldset>

      {/* 69 terms as a flat list was the tallest thing on this form by far, so
          it collapses to a summary and filters (fix list). */}
      {services.length === 0 ? (
        <fieldset>
          <legend className={label}>Services you offer</legend>
          <p className="mt-2 text-sm text-graphite">No services have been set up yet.</p>
        </fieldset>
      ) : (
        <ServicesPicker services={services} selected={selectedServiceIds} legendClass={label} />
      )}

      <div>
        <label htmlFor="slug" className={label}>Web address</label>
        <div className="mt-1 flex items-center gap-1">
          <span className="text-sm text-graphite">/member/</span>
          <input id="slug" name="slug" defaultValue={member.slug} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="w-full rounded border px-3 py-2 text-base" />
        </div>
        {!isDraft && (
          isConsole ? (
            <label className="mt-1.5 flex items-center gap-2 py-1 text-sm text-graphite sm:text-xs">
              <input type="checkbox" className={check} name="confirm_slug" />
              Changing this changes their public URL — old links will be redirected automatically.
            </label>
          ) : (
            <p className="mt-1.5 text-xs text-graphite">
              Changing this changes your public URL. Old links keep working — we redirect them.
            </p>
          )
        )}
      </div>

      <h2 className={groupHeading}>Page content</h2>
      <div>
        <span className={label}>{isConsole ? "About the company" : "About your company"}</span>
        <RichTextEditor
          name="description"
          ariaLabel={isConsole ? "About the company" : "About your company"}
          initialHtml={renderableHtml(member.description)}
          uploadImage={uploadImage}
          minHeightClass="min-h-56"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="logo" className={label}>Company logo</label>
          {logoUrl && <Image src={logoUrl} alt="" width={64} height={64} className="mt-1 rounded border" unoptimized />}
          <UploadField id="logo" name="logo" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">Square works best, min 200×200px. Leave empty to keep the current one.</p>
          {logoUrl && (
            <label className="mt-1 flex items-center gap-2 py-1 text-sm text-graphite sm:text-xs">
              <input type="checkbox" className={check} name="remove_logo" /> Remove the current logo
            </label>
          )}
        </div>
        <div>
          <label htmlFor="hero" className={label}>Cover photo</label>
          {heroUrl && <Image src={heroUrl} alt="" width={128} height={64} className="mt-1 rounded border object-cover" unoptimized />}
          <UploadField id="hero" name="hero" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">Landscape, around 800×400px. Leave empty to keep the current one.</p>
          {heroUrl && (
            <label className="mt-1 flex items-center gap-2 py-1 text-sm text-graphite sm:text-xs">
              <input type="checkbox" className={check} name="remove_hero" /> Remove the current cover
            </label>
          )}
        </div>
      </div>

      <h2 className={groupHeading}>Contact and location</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="address" className={label}>Address</label>
          <input id="address" name="address" defaultValue={member.address ?? ""} autoComplete="street-address" className={field} />
        </div>
        <div>
          <label htmlFor="phone" className={label}>Phone</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={member.phone ?? ""} className={field} />
          <p className="mt-1 text-xs text-graphite">Digits, spaces, +, ( ) and - only.</p>
        </div>
        <div>
          <label htmlFor="website" className={label}>Website</label>
          <input id="website" name="website" inputMode="url" autoComplete="url" autoCapitalize="none" defaultValue={member.website ?? ""} className={field} />
        </div>
        <div>
          <label htmlFor="video_url" className={label}>YouTube video URL</label>
          <input id="video_url" name="video_url" inputMode="url" autoCapitalize="none" defaultValue={member.video_url ?? ""} className={field} />
        </div>
        <div>
          <label htmlFor="contact_email" className={label}>Contact email</label>
          <input id="contact_email" name="contact_email" type="email" autoComplete="email" defaultValue={member.contact_email ?? ""} className={field} />
          <p className="mt-1 text-xs text-graphite">
            {isConsole
              ? "Where their notifications go. This is not their login — changing it here does not change how they sign in."
              : "Where enquiries reach you — not your login email."}
          </p>
        </div>
        <div />
        <div>
          <label htmlFor="lat" className={label}>Latitude</label>
          <input id="lat" name="lat" defaultValue={member.lat ?? ""} inputMode="decimal" className={field} />
        </div>
        <div>
          <label htmlFor="lng" className={label}>Longitude</label>
          <input id="lng" name="lng" defaultValue={member.lng ?? ""} inputMode="decimal" className={field} />
        </div>
      </div>
      <p className="-mt-2 text-xs text-graphite">
        Latitude and longitude place the map on {isConsole ? "their" : "your"} profile. Leave both empty and we&apos;ll
        work them out from the address; leave the address empty too for no map.
      </p>

      <fieldset>
        <legend className={`${groupHeading} w-full`}>Social profiles</legend>
        <p className="text-xs text-graphite">
          Paste the full link to each page — they appear on the profile and let us tag {isConsole ? "them" : "you"} when
          stories are shared.
        </p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {SOCIAL_CHANNELS.map((c) => (
            <label key={c.key} className="text-sm">
              <span className="text-graphite">{c.label}</span>
              <input name={socialFieldName(c.key)} defaultValue={social[c.key] ?? ""} placeholder={c.placeholder} inputMode="url" autoCapitalize="none" className={field} />
            </label>
          ))}
        </div>
      </fieldset>
    </fieldset>
  );
}
