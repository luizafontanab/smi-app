import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { submitProfileEdit } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Update your page" };

export default async function MemberProfilePage() {
  const user = await requireMember();
  const db = serviceDb();
  const [{ data: m }, { data: pendingRev }] = await Promise.all([
    db.from("members").select("description, address, phone, website, video_url, social").eq("id", user.memberId).single(),
    db.from("member_revisions").select("id").eq("member_id", user.memberId).eq("status", "awaiting_approval").limit(1),
  ]);
  const social = (m?.social ?? {}) as Record<string, string>;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/member" className="text-sm text-gray-400 hover:text-navy">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-navy">Update your page</h1>
      {pendingRev?.length ? (
        <p className="mt-2 rounded bg-amber/10 p-2 text-sm text-gray-600">You have changes awaiting approval — new edits replace them.</p>
      ) : (
        <p className="mt-1 text-sm text-gray-500">Changes go live after a quick editorial check.</p>
      )}
      <form action={submitProfileEdit} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <label className="text-sm font-medium">About your company</label>
          <textarea name="description" rows={5} defaultValue={m?.description ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="text-sm font-medium">Address</label><input name="address" defaultValue={m?.address ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
          <div><label className="text-sm font-medium">Phone</label><input name="phone" defaultValue={m?.phone ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
          <div><label className="text-sm font-medium">Website</label><input name="website" defaultValue={m?.website ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
          <div><label className="text-sm font-medium">YouTube video URL</label><input name="video_url" defaultValue={m?.video_url ?? ""} className="mt-1 w-full rounded border px-3 py-2" /></div>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Social handles (used to tag you when we share your stories)</legend>
          <div className="mt-1 grid gap-4 sm:grid-cols-2">
            <input name="linkedin" defaultValue={social.linkedin ?? ""} placeholder="LinkedIn (company/…)" className="rounded border px-3 py-2" />
            <input name="x" defaultValue={social.x ?? ""} placeholder="X handle" className="rounded border px-3 py-2" />
            <input name="facebook" defaultValue={social.facebook ?? ""} placeholder="Facebook page" className="rounded border px-3 py-2" />
            <input name="instagram" defaultValue={social.instagram ?? ""} placeholder="Instagram" className="rounded border px-3 py-2" />
          </div>
        </fieldset>
        <button className="rounded bg-navy px-5 py-2.5 text-white">Submit changes</button>
      </form>
    </div>
  );
}
