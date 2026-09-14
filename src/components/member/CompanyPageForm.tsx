import Image from "next/image";
import { socialFieldName } from "@/lib/member-form";
import { renderableHtml } from "@/lib/sanitize";
import { SOCIAL_CHANNELS } from "@/lib/social";
import { RichTextEditor } from "@/components/RichTextEditor";

const field = "mt-1 w-full rounded border px-3 py-2";
const label = "text-sm font-medium";

export type CompanyPageMember = {
  name: string;
  slug: string;
  status: string;
  industry_id: number | null;
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
 * `mode` gates exactly two things, and nothing cosmetic:
 *   · membership types — read-only for a member, who must not be able to
 *     self-assign a directory tier (GAPS A8.1); the console gets checkboxes.
 *   · the slug confirmation — the console's operator ticks it deliberately; a
 *     member's rename is approval-gated anyway, so Jas is the confirmation.
 */
export function CompanyPageForm({
  mode,
  member,
  industries,
  services,
  membershipTypes,
  selectedServiceIds,
  selectedMembershipTypeIds,
  uploadImage,
  logoUrl,
  heroUrl,
}: {
  mode: "console" | "member";
  member: CompanyPageMember;
  industries: Taxonomy[];
  services: Taxonomy[];
  membershipTypes: Taxonomy[];
  selectedServiceIds: Set<number>;
  selectedMembershipTypeIds: Set<number>;
  uploadImage: (formData: FormData) => Promise<string | null>;
  logoUrl: string | null;
  heroUrl: string | null;
}) {
  const social = (member.social ?? {}) as Record<string, string>;
  const isDraft = member.status === "draft";
  const isConsole = mode === "console";

  return (
    <fieldset className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className={label}>Company name</label>
          <input id="name" name="name" defaultValue={member.name} required className={field} />
        </div>
        <div>
          <label htmlFor="industry_id" className={label}>Industry</label>
          <select id="industry_id" name="industry_id" defaultValue={member.industry_id ?? ""} className={field}>
            <option value="">— none —</option>
            {industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className={label}>Membership types</legend>
        <p className="text-xs text-graphite">
          Shown on the public directory as a filter — distinct from Industry above, and from the Services list.
          {!isConsole && " Set by SMI; contact us to change it."}
        </p>
        {isConsole ? (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {membershipTypes.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="membership_types" value={t.id} defaultChecked={selectedMembershipTypeIds.has(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink">
            {membershipTypes.filter((t) => selectedMembershipTypeIds.has(t.id)).map((t) => t.name).join(", ") || "Not set"}
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend className={label}>Services you offer</legend>
        <p className="text-xs text-graphite">Choose everything that applies — these are how buyers filter the member directory.</p>
        {services.length === 0 ? (
          <p className="mt-2 text-sm text-graphite">No services have been set up yet.</p>
        ) : (
          <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="services" value={s.id} defaultChecked={selectedServiceIds.has(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div>
        <label htmlFor="slug" className={label}>Web address</label>
        <div className="mt-1 flex items-center gap-1">
          <span className="text-sm text-graphite">/member/</span>
          <input id="slug" name="slug" defaultValue={member.slug} className="w-full rounded border px-3 py-2" />
        </div>
        {!isDraft && (
          isConsole ? (
            <label className="mt-1.5 flex items-center gap-2 text-xs text-graphite">
              <input type="checkbox" name="confirm_slug" />
              Changing this changes their public URL — old links will be redirected automatically.
            </label>
          ) : (
            <p className="mt-1.5 text-xs text-graphite">
              Changing this changes your public URL. Old links keep working — we redirect them.
            </p>
          )
        )}
      </div>

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
          <input id="logo" type="file" name="logo" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">Square works best, min 200×200px. Leave empty to keep the current one.</p>
          {logoUrl && (
            <label className="mt-1 flex items-center gap-2 text-xs text-graphite">
              <input type="checkbox" name="remove_logo" /> Remove the current logo
            </label>
          )}
        </div>
        <div>
          <label htmlFor="hero" className={label}>Cover photo</label>
          {heroUrl && <Image src={heroUrl} alt="" width={128} height={64} className="mt-1 rounded border object-cover" unoptimized />}
          <input id="hero" type="file" name="hero" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">Landscape, around 800×400px. Leave empty to keep the current one.</p>
          {heroUrl && (
            <label className="mt-1 flex items-center gap-2 text-xs text-graphite">
              <input type="checkbox" name="remove_hero" /> Remove the current cover
            </label>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="address" className={label}>Address</label>
          <input id="address" name="address" defaultValue={member.address ?? ""} className={field} />
        </div>
        <div>
          <label htmlFor="phone" className={label}>Phone</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={member.phone ?? ""} className={field} />
          <p className="mt-1 text-xs text-graphite">Digits, spaces, +, ( ) and - only.</p>
        </div>
        <div>
          <label htmlFor="website" className={label}>Website</label>
          <input id="website" name="website" defaultValue={member.website ?? ""} className={field} />
        </div>
        <div>
          <label htmlFor="video_url" className={label}>YouTube video URL</label>
          <input id="video_url" name="video_url" defaultValue={member.video_url ?? ""} className={field} />
        </div>
        <div>
          <label htmlFor="contact_email" className={label}>Contact email</label>
          <input id="contact_email" name="contact_email" type="email" defaultValue={member.contact_email ?? ""} className={field} />
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
        <legend className={label}>Social profiles</legend>
        <p className="text-xs text-graphite">
          Paste the full link to each page — they appear on the profile and let us tag {isConsole ? "them" : "you"} when
          stories are shared.
        </p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {SOCIAL_CHANNELS.map((c) => (
            <label key={c.key} className="text-sm">
              <span className="text-graphite">{c.label}</span>
              <input name={socialFieldName(c.key)} defaultValue={social[c.key] ?? ""} placeholder={c.placeholder} className={field} />
            </label>
          ))}
        </div>
      </fieldset>
    </fieldset>
  );
}
