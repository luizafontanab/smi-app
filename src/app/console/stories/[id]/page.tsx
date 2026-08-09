import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { decideStory, saveStory, scheduleStory } from "../../actions";
import { FocusPicker } from "@/components/FocusPicker";

export const dynamic = "force-dynamic";

export default async function StoryEditor(props: PageProps<"/console/stories/[id]">) {
  const { id } = await props.params;
  await requireConsole();
  const db = serviceDb();
  const isNew = id === "new";

  const [{ data: story }, { data: cats }, { data: members }] = await Promise.all([
    isNew
      ? Promise.resolve({ data: null })
      : db.from("stories").select("*, member:members(name, logo_path, slug)").eq("id", id).single(),
    db.from("categories").select("id, name").eq("kind", "story").order("name"),
    db.from("members").select("id, name").eq("status", "active").order("name"),
  ]);
  if (!isNew && !story) notFound();
  const { data: selectedCats } = isNew
    ? { data: [] }
    : await db.from("story_categories").select("category_id").eq("story_id", id);
  const selected = new Set((selectedCats ?? []).map((c) => c.category_id));
  const cover = mediaUrl(story?.cover_path);
  const focus = (story?.cover_focus ?? { x: 0.5, y: 0.5, scale: 1 }) as { x: number; y: number; scale: number };

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/stories" className="text-sm text-gray-400 hover:text-navy">← Story Engine</Link>
      <h1 className="mt-1 text-xl font-bold text-navy">{isNew ? "New story" : "Edit story"}</h1>
      {story?.status === "rejected" && (
        <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-600">Rejected: {story.rejected_reason}</p>
      )}

      <form action={saveStory} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        {!isNew && <input type="hidden" name="id" value={id} />}
        <div>
          <label className="text-sm font-medium">Title</label>
          <input name="title" defaultValue={story?.title ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label className="text-sm font-medium">Excerpt</label>
          <textarea name="excerpt" defaultValue={story?.excerpt ?? ""} rows={2} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label className="text-sm font-medium">Body (HTML)</label>
          <textarea name="body" defaultValue={story?.body ?? ""} rows={14} className="mt-1 w-full rounded border px-3 py-2 font-mono text-xs" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Subject member (adds backlink + branding)</label>
            <select name="member_id" defaultValue={story?.member_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_member_news" defaultChecked={story?.is_member_news ?? false} />
            Member news (badged on the site)
          </label>
        </div>
        <div>
          <label className="text-sm font-medium">Categories</label>
          <div className="mt-1 flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded border p-2 text-sm">
            {(cats ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-1.5">
                <input type="checkbox" name="categories" value={c.id} defaultChecked={selected.has(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        {cover && (
          <div>
            <label className="text-sm font-medium">Cover crop focus (pan/zoom — fixes lost heads)</label>
            <FocusPicker src={cover} initial={focus} />
          </div>
        )}
        <button className="rounded bg-navy px-5 py-2.5 text-white">Save</button>
      </form>

      {!isNew && story && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {story.status === "awaiting_approval" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-navy">Approval</h2>
              <p className="mt-1 text-xs text-gray-500">Preview shows backlink + logo exactly as it will publish. Edit above first if needed.</p>
              <div className="mt-3 flex gap-2">
                <form action={decideStory}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="rounded bg-green-600 px-4 py-2 text-sm text-white">Approve & publish</button>
                </form>
              </div>
              <form action={decideStory} className="mt-3 flex gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="decision" value="reject" />
                <input name="reason" placeholder="Reason (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
                <button className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">Reject</button>
              </form>
            </div>
          )}
          {(story.status === "draft" || story.status === "rejected" || story.status === "scheduled") && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-navy">Schedule</h2>
              <form action={scheduleStory} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="datetime-local" name="scheduled_at" defaultValue={story.scheduled_at?.slice(0, 16) ?? ""} className="rounded border px-3 py-1.5 text-sm" />
                <button className="rounded bg-navy px-4 py-2 text-sm text-white">Schedule</button>
                <button name="mode" value="now" className="rounded bg-amber px-4 py-2 text-sm font-semibold text-navy">Publish now (urgent)</button>
              </form>
              <p className="mt-2 text-xs text-gray-400">Social push follows publication after the configured delay; daily cap applies.</p>
            </div>
          )}
          {story.member && (
            <div className="rounded-xl bg-white p-5 shadow-sm text-sm">
              <h2 className="font-bold text-navy">Member preview</h2>
              <div className="mt-2 flex items-center gap-3 rounded border-2 border-amber bg-amber/5 p-3">
                {story.member.logo_path && <Image src={mediaUrl(story.member.logo_path)!} alt="" width={40} height={40} className="rounded" unoptimized />}
                <span>Backlink + footer branding → <b>{story.member.name}</b></span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
