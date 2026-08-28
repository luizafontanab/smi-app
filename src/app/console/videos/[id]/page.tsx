import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { consoleUploadVideoImage, decideVideo, saveVideo, scheduleVideo } from "../../actions";
import { RichTextEditor } from "@/components/RichTextEditor";
import { YoutubePreview } from "@/components/YoutubePreview";

export const dynamic = "force-dynamic";

export default async function VideoEditor(props: PageProps<"/console/videos/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const isNew = id === "new";

  // arrived from the calendar view — go back there after scheduling, not to the board
  const backTo = sp.from === "calendar"
    ? `/console/videos?view=calendar${/^\d{4}-\d{2}$/.test(String(sp.month ?? "")) ? `&month=${sp.month}` : ""}`
    : "/console/videos";

  const [{ data: video }, { data: members }] = await Promise.all([
    isNew
      ? Promise.resolve({ data: null })
      : db.from("videos").select("*, member:members(name, logo_path, slug)").eq("id", id).single(),
    db.from("members").select("id, name").eq("status", "active").order("name"),
  ]);
  if (!isNew && !video) notFound();
  const thumbnail = mediaUrl(video?.thumbnail_path);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={backTo} className="text-sm text-gray-400 hover:text-ink">← Video Engine</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New video" : "Edit video"}</h1>
      {video?.status === "rejected" && (
        <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-600">Rejected: {video.rejected_reason}</p>
      )}

      <form action={saveVideo} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        {!isNew && <input type="hidden" name="id" value={id} />}
        <div>
          <label htmlFor="title" className="text-sm font-medium">Title</label>
          <input id="title" name="title" defaultValue={video?.title ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <YoutubePreview name="url" defaultValue={video?.url ?? ""} />
        <div>
          <span className="block text-sm font-medium">Description</span>
          <RichTextEditor name="description" ariaLabel="Description" initialHtml={video?.description ?? ""} uploadImage={consoleUploadVideoImage} minHeightClass="min-h-40" />
        </div>
        <div>
          <span className="block text-sm font-medium">Thumbnail</span>
          {thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt="" className="mt-2 h-32 w-auto rounded object-cover" />
          )}
          <input type="file" name="thumbnail" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          <p className="mt-1 text-xs text-gray-400">
            Falls back to the YouTube thumbnail if left blank. Landscape, JPG/PNG/WebP, max 8MB.
          </p>
        </div>
        <div>
          <label htmlFor="member_id" className="text-sm font-medium">Subject member (adds backlink + branding)</label>
          <select id="member_id" name="member_id" defaultValue={video?.member_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
            <option value="">— none —</option>
            {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
      </form>

      {!isNew && video && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {video.status === "awaiting_approval" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Approval</h2>
              <p className="mt-1 text-xs text-gray-500">Preview shows backlink + logo exactly as it will publish. Edit above first if needed.</p>
              <div className="mt-3 flex gap-2">
                <form action={decideVideo}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="rounded bg-green-600 px-4 py-2 text-sm text-white">Approve & publish</button>
                </form>
              </div>
              <form action={decideVideo} className="mt-3 flex gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="decision" value="reject" />
                <input name="reason" placeholder="Reason (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
                <button className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">Reject</button>
              </form>
            </div>
          )}
          {(video.status === "draft" || video.status === "rejected" || video.status === "scheduled") && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Schedule</h2>
              <form action={scheduleVideo} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="return_to" value={backTo} />
                <input type="datetime-local" name="scheduled_at" defaultValue={video.scheduled_at?.slice(0, 16) ?? ""} className="rounded border px-3 py-1.5 text-sm" />
                <button className="rounded bg-ink px-4 py-2 text-sm text-white">Schedule</button>
                <button name="mode" value="now" className="rounded bg-brand px-4 py-2 text-sm font-semibold text-ink">Publish now (urgent)</button>
              </form>
              <p className="mt-2 text-xs text-gray-400">Social push follows publication after the configured delay; daily cap applies.</p>
            </div>
          )}
          {video.member && (
            <div className="rounded-xl bg-white p-5 shadow-sm text-sm">
              <h2 className="font-bold text-ink">Member preview</h2>
              <div className="mt-2 flex items-center gap-3 rounded border-2 border-brand bg-brand/5 p-3">
                {video.member.logo_path && <Image src={mediaUrl(video.member.logo_path)!} alt="" width={40} height={40} className="rounded" unoptimized />}
                <span>Backlink + footer branding → <b>{video.member.name}</b></span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
