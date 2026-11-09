import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { consoleUploadVideoImage, decideVideo, pinVideo, returnToDraft, saveVideo, scheduleVideo, setVideoStatus, confirmVideoSocial, videoSocialTool } from "../../actions";
import { RichTextEditor } from "@/components/RichTextEditor";
import { YoutubePreview } from "@/components/YoutubePreview";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { MirrorInput } from "@/components/console/MirrorInput";
import { SubmitButton } from "@/components/SubmitButton";
import { UploadField } from "@/components/UploadField";
import { SocialConfirmForm, SocialPostFields, SocialToolForm } from "@/components/console/SocialPostFields";
import { socialWriterLive } from "@/lib/adapters/social-writer";
import { latestSocialJob, readSocialCaps } from "@/lib/social-push";
import { cachedChannelNetworks, isSocialLive } from "@/lib/adapters/social";
import { loadSocialPanel, videoSocialItem } from "@/lib/social-post";
import { socialNotes } from "@/lib/social-confirm";
import { formatLondon, londonInputValue } from "@/lib/london-time";
import { excerptFromHtml } from "@/lib/sanitize";

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

  // Keep a malformed id a 404 rather than an invalid-uuid throw from must().
  if (!isNew && !UUID_RE.test(id)) notFound();

  const [video, members, inds, socialCaps, socialJob] = await Promise.all([
    isNew
      ? Promise.resolve(null)
      : must(db.from("videos").select("*, member:members(name, logo_path, slug, industry_id, social, status, archived_at)").eq("id", id).maybeSingle(), "console/videos editor"),
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/videos members"),
    must(db.from("industries").select("id, name").order("sort_order"), "console/videos industries"),
    readSocialCaps(db),
    isNew ? Promise.resolve(null) : latestSocialJob(db, { video_id: id }),
  ]);
  if (!isNew && !video) notFound();
  const thumbnail = mediaUrl(video?.thumbnail_path);
  // Pre-populate from the subject member when the video has no industry of its
  // own (fix list) — which is every video created before the field existed, and
  // every one submitted by a member. An explicit choice on the row always wins.
  // Read off the row's own member embed, not the dropdown list: that list is
  // filtered to active members, so a grace or lapsed member's video would
  // silently get no fallback at all. Matches the story and event editors.
  const industryDefault = video?.industry_id ?? video?.member?.industry_id ?? "";
  // Approve / Schedule send the Industry box as it stands, so what Jas sees is what goes Live.
  const industryField = <MirrorInput source="industry_id" name="industry_id" defaultValue={String(industryDefault)} />;
  const isPinned = !!video?.pinned_until && new Date(video.pinned_until) > new Date();
  // Issue #43: each channel's preview, confirmation and status, built from the row already read above.
  const socialPanel = video
    ? await loadSocialPanel(db, { video_id: id }, {
      networks: () => cachedChannelNetworks(),
      delayMinutes: socialCaps.delay_minutes,
      item: videoSocialItem(video),
    })
    : null;
  const socialNoteLines = video ? socialNotes({ live: isSocialLive(), job: socialJob }) : [];

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={backTo} className="text-sm text-graphite hover:text-ink">← Video Engine</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New video" : "Edit video"}</h1>
      {video?.status === "rejected" && (
        <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">Rejected: {video.rejected_reason}</p>
      )}
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveVideo} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <UnsavedChangesGuard />
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
          <UploadField name="thumbnail" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">
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
        <div>
          {/* videos.industry_id has existed since 20260909000002, which backfilled
              it from the subject member's industry, but nothing could set it
              afterwards — no form wrote the column (fix list). */}
          <label htmlFor="industry_id" className="text-sm font-medium">Industry</label>
          <select id="industry_id" name="industry_id" defaultValue={industryDefault} className="mt-1 w-full rounded border px-3 py-2">
            <option value="">— none —</option>
            {(inds ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-graphite">Drives /industry/* listings and the industry filter.</p>
        </div>
        <SocialPostFields
          item={video}
          fallback={excerptFromHtml(video?.description) ?? video?.title ?? ""}
          fallbackName="description"
          caps={socialCaps}
          panel={socialPanel}
          notes={socialNoteLines}
          confirmable={!!video}
          confirmed={typeof sp.confirmed === "string" ? sp.confirmed : undefined}
          mode={typeof sp.mode === "string" ? sp.mode : undefined}
          tools={video ? { writer: socialWriterLive(), buffer: isSocialLive() } : undefined}
          written={typeof sp.written === "string" ? sp.written : undefined}
          drafted={typeof sp.drafted === "string" ? sp.drafted : undefined}
        />
        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Save</SubmitButton>
      </form>
      {video && <SocialConfirmForm action={confirmVideoSocial} id={id} />}
      {video && <SocialToolForm action={videoSocialTool} id={id} />}

      {!isNew && video && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Ready to review: approve for a time first, publish now as the
              urgent option; "not yet" depends on who sent it in (as stories). */}
          {video.status === "awaiting_approval" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Ready to review</h2>
              <form action={scheduleVideo} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="return_to" value={backTo} />
                {industryField}
                <label htmlFor="approve_at" className="sr-only">Publish at (UK time)</label>
                <input id="approve_at" type="datetime-local" name="scheduled_at" required defaultValue={londonInputValue(video.scheduled_at)} className="rounded border px-3 py-1.5 text-sm" />
                <SubmitButton pendingLabel="Approving…" className="rounded bg-success px-4 py-2 text-sm text-white">Approve & schedule</SubmitButton>
              </form>
              <form action={decideVideo} className="mt-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="decision" value="approve" />
                {industryField}
                <SubmitButton pendingLabel="Publishing…" className="rounded border border-ink px-3 py-1.5 text-sm text-ink">Approve & publish now (urgent)</SubmitButton>
              </form>
              {video.source === "member" ? (
                <form action={decideVideo} className="mt-4 flex gap-2 border-t pt-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="decision" value="reject" />
                  <input name="reason" aria-label="Reason (sent to the member)" placeholder="Reason (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
                  <SubmitButton pendingLabel="Sending back…" className="shrink-0 rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Send back</SubmitButton>
                </form>
              ) : (
                <form action={decideVideo} className="mt-4 border-t pt-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="decision" value="reject" />
                  <SubmitButton pendingLabel="Returning…" className="rounded border border-black/15 px-3 py-1.5 text-sm text-ink">Not yet — back to draft</SubmitButton>
                  <p className="mt-1 text-xs text-graphite">Nobody is emailed. Edit it, then mark it ready to review again.</p>
                </form>
              )}
            </div>
          )}
          {(video.status === "draft" || video.status === "rejected" || video.status === "scheduled") && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Schedule</h2>
              <form action={scheduleVideo} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="return_to" value={backTo} />
                {industryField}
                <label htmlFor="schedule_at" className="sr-only">Publish at (UK time)</label>
                <input id="schedule_at" type="datetime-local" name="scheduled_at" defaultValue={londonInputValue(video.scheduled_at)} className="rounded border px-3 py-1.5 text-sm" />
                <SubmitButton pendingLabel="Scheduling…" className="rounded bg-ink px-4 py-2 text-sm text-white">Schedule</SubmitButton>
                <SubmitButton pendingLabel="Publishing…" name="mode" value="now" className="rounded bg-brand px-4 py-2 text-sm font-semibold text-ink">Publish now (urgent)</SubmitButton>
              </form>
              <p className="mt-2 text-xs text-graphite">
                Times are UK time. The social post follows its own time, set under Social post above.
              </p>
              {video.status === "draft" && (
                <form action={setVideoStatus} className="mt-4 border-t pt-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value="awaiting_approval" />
                  <input type="hidden" name="return_to" value={`/console/videos/${id}`} />
                  <SubmitButton pendingLabel="Marking…" className="rounded border border-black/15 px-3 py-1.5 text-sm text-ink">Mark ready to review</SubmitButton>
                  <p className="mt-1 text-xs text-graphite">Optional. Puts it in Ready to review for a final check before it&apos;s scheduled.</p>
                </form>
              )}
            </div>
          )}
          {video.status === "published" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Pin to headline</h2>
              <p className="mt-1 text-xs text-graphite">Pinned videos get a featured slot on /video.</p>
              <form action={pinVideo} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="id" value={id} />
                {isPinned ? (
                  <>
                    <p className="text-xs text-graphite">Pinned until {formatLondon(video.pinned_until!)}</p>
                    <input type="hidden" name="days" value="0" />
                    <SubmitButton pendingLabel="Unpinning…" className="rounded border px-3 py-1.5">Unpin</SubmitButton>
                  </>
                ) : (
                  <>
                    <input type="number" name="days" defaultValue={2} min={1} max={30} className="w-16 rounded border px-2 py-1.5" />
                    <span className="text-xs text-graphite">days</span>
                    <SubmitButton pendingLabel="Pinning…" className="rounded bg-ink px-3 py-1.5 text-white">Pin</SubmitButton>
                  </>
                )}
              </form>
              {/* Videos had no route back from published at all before this —
                  neither a button nor, until the board gained drag, a card
                  move (fix list). */}
              <form action={returnToDraft} className="mt-4 border-t pt-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="kind" value="video" />
                <SubmitButton pendingLabel="Returning…" className="rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Return to draft</SubmitButton>
                <p className="mt-1 text-xs text-graphite">Takes it off the site straight away. The member is not emailed.</p>
              </form>
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
