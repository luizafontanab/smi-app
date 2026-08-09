import Link from "next/link";
import { publicDb } from "@/lib/db/server";
import { submitStory } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a story" };

export default async function NewMemberStory() {
  const { data: cats } = await publicDb().from("categories").select("id, name").eq("kind", "story").order("name");
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/member" className="text-sm text-gray-400 hover:text-navy">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-navy">Add a story</h1>
      <p className="mt-1 text-sm text-gray-500">
        The editor reviews every story before it goes live. Once approved it&apos;s published with a link back to
        your page and shared on SMI&apos;s social channels.
      </p>
      <form action={submitStory} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <label className="text-sm font-medium">Title</label>
          <input name="title" required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label className="text-sm font-medium">Summary (1–2 sentences)</label>
          <textarea name="excerpt" rows={2} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label className="text-sm font-medium">Story</label>
          <textarea name="body" required rows={10} className="mt-1 w-full rounded border px-3 py-2" placeholder="Write naturally — paragraphs separated by a blank line." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Category</label>
            <select name="category" className="mt-1 w-full rounded border px-3 py-2">
              {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Cover image</label>
            <input type="file" name="cover" accept="image/jpeg,image/png,image/webp" className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-gray-400">
              Landscape works best: at least 1200×675px (16:9), JPG/PNG, max 8MB. Keep faces and key detail near the centre.
            </p>
          </div>
        </div>
        <button className="rounded bg-navy px-5 py-2.5 text-white">Submit for approval</button>
      </form>
    </div>
  );
}
