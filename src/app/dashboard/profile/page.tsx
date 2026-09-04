import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { renderableHtml } from "@/lib/sanitize";
import { SOCIAL_CHANNELS } from "@/lib/social";
import { RichTextEditor } from "@/components/RichTextEditor";
import { memberUploadImage, submitProfileEdit } from "../actions";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Update your page" };

export default async function MemberProfilePage(props: PageProps<"/dashboard/profile">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const db = serviceDb();
  const [{ data: m }, { data: pendingRev }, { data: cats }] = await Promise.all([
    db.from("members").select("status, description, address, phone, website, video_url, social, category_id, contact_email").eq("id", user.memberId).single(),
    db.from("member_revisions").select("id").eq("member_id", user.memberId).eq("status", "awaiting_approval").limit(1),
    db.from("categories").select("id, name").eq("kind", "member").order("name"),
  ]);
  const social = (m?.social ?? {}) as Record<string, string>;
  const isDraft = m?.status === "draft";
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="mx-auto max-w-2xl">
      {isDraft && <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-brand-text">Step 3 of 4</p>}
      <h1 className="mt-1 text-xl font-bold text-ink">{isDraft ? "Build your company page" : "Update your page"}</h1>
      {isDraft ? (
        <p className="mt-1 text-sm text-graphite">Submitting sends your page to Jas for review — once approved, you&apos;re live in the directory.</p>
      ) : pendingRev?.length ? (
        <p className="mt-2 rounded bg-brand/10 p-2 text-sm text-graphite">You have changes awaiting approval — new edits replace them.</p>
      ) : (
        <p className="mt-1 text-sm text-graphite">Changes go live after a quick editorial check.</p>
      )}
      {error && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{error}</p>}
      <form action={submitProfileEdit} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <UnsavedChangesGuard />
        <div>
          <span className="block text-sm font-medium">About your company</span>
          <RichTextEditor name="description" ariaLabel="About your company" initialHtml={renderableHtml(m?.description)} uploadImage={memberUploadImage} minHeightClass="min-h-36" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="logo" className="text-sm font-medium">Company logo</label>
            <input id="logo" type="file" name="logo" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-graphite">Square works best, min 200×200px. Leave empty to keep the current one.</p>
          </div>
          <div>
            <label htmlFor="hero" className="text-sm font-medium">Cover photo</label>
            <input id="hero" type="file" name="hero" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-graphite">Landscape, around 800×400px. Leave empty to keep the current one.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="address" className="text-sm font-medium">Address</label>
            <input id="address" name="address" defaultValue={m?.address ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
            <p className="mt-1 text-xs text-graphite">Placed on your map automatically when this changes.</p>
          </div>
          <div>
            <label htmlFor="phone" className="text-sm font-medium">Phone</label>
            <input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={m?.phone ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
            <p className="mt-1 text-xs text-graphite">Digits, spaces, +, ( ) and - only.</p>
          </div>
          <div><label htmlFor="website" className="text-sm font-medium">Website</label><input id="website" name="website" defaultValue={m?.website ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
          <div><label htmlFor="video_url" className="text-sm font-medium">YouTube video URL</label><input id="video_url" name="video_url" defaultValue={m?.video_url ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
          <div>
            <label htmlFor="category_id" className="text-sm font-medium">Sector</label>
            <select id="category_id" name="category_id" defaultValue={m?.category_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="contact_email" className="text-sm font-medium">Contact email</label>
            <input id="contact_email" name="contact_email" type="email" defaultValue={m?.contact_email ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
            <p className="mt-1 text-xs text-graphite">Where enquiries reach you — not your login email.</p>
          </div>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Social profiles</legend>
          <p className="text-xs text-graphite">Paste the full link to each page — they appear on your profile and let us tag you when we share your stories.</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {SOCIAL_CHANNELS.map((c) => (
              <label key={c.key} className="text-sm">
                <span className="text-graphite">{c.label}</span>
                <input name={c.key} defaultValue={social[c.key] ?? ""} placeholder={c.placeholder} className="mt-1 w-full rounded border px-3 py-2" />
              </label>
            ))}
          </div>
        </fieldset>
        <button className="rounded bg-ink px-5 py-2.5 text-white">{isDraft ? "Submit page for approval" : "Submit changes"}</button>
      </form>
    </div>
  );
}
