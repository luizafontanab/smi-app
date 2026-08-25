import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { renderableHtml } from "@/lib/sanitize";
import { SOCIAL_CHANNELS } from "@/lib/social";
import { RichTextEditor } from "@/components/RichTextEditor";
import { memberUploadImage, submitProfileEdit } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Update your page" };

export default async function MemberProfilePage() {
  const user = await requireMember();
  const db = serviceDb();
  const [{ data: m }, { data: pendingRev }] = await Promise.all([
    db.from("members").select("status, description, address, phone, website, video_url, social").eq("id", user.memberId).single(),
    db.from("member_revisions").select("id").eq("member_id", user.memberId).eq("status", "awaiting_approval").limit(1),
  ]);
  const social = (m?.social ?? {}) as Record<string, string>;
  const isDraft = m?.status === "draft";

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="text-sm text-gray-400 hover:text-ink">← Dashboard</Link>
      {isDraft && <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-brand">Step 3 of 4</p>}
      <h1 className="mt-1 text-xl font-bold text-ink">{isDraft ? "Build your company page" : "Update your page"}</h1>
      {isDraft ? (
        <p className="mt-1 text-sm text-gray-500">Submitting sends your page to Jas for review — once approved, you&apos;re live in the directory.</p>
      ) : pendingRev?.length ? (
        <p className="mt-2 rounded bg-brand/10 p-2 text-sm text-gray-600">You have changes awaiting approval — new edits replace them.</p>
      ) : (
        <p className="mt-1 text-sm text-gray-500">Changes go live after a quick editorial check.</p>
      )}
      <form action={submitProfileEdit} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <span className="block text-sm font-medium">About your company</span>
          <RichTextEditor name="description" ariaLabel="About your company" initialHtml={renderableHtml(m?.description)} uploadImage={memberUploadImage} minHeightClass="min-h-36" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="logo" className="text-sm font-medium">Company logo</label>
            <input id="logo" type="file" name="logo" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-gray-400">Square works best, min 200×200px. Leave empty to keep the current one.</p>
          </div>
          <div>
            <label htmlFor="hero" className="text-sm font-medium">Cover photo</label>
            <input id="hero" type="file" name="hero" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-gray-400">Landscape, around 800×400px. Leave empty to keep the current one.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="address" className="text-sm font-medium">Address</label><input id="address" name="address" defaultValue={m?.address ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
          <div><label htmlFor="phone" className="text-sm font-medium">Phone</label><input id="phone" name="phone" defaultValue={m?.phone ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
          <div><label htmlFor="website" className="text-sm font-medium">Website</label><input id="website" name="website" defaultValue={m?.website ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
          <div><label htmlFor="video_url" className="text-sm font-medium">YouTube video URL</label><input id="video_url" name="video_url" defaultValue={m?.video_url ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Social profiles</legend>
          <p className="text-xs text-gray-400">Paste the full link to each page — they appear on your profile and let us tag you when we share your stories.</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {SOCIAL_CHANNELS.map((c) => (
              <label key={c.key} className="text-sm">
                <span className="text-gray-500">{c.label}</span>
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
