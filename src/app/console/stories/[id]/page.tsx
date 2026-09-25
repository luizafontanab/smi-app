import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { consoleUploadImage, decideStory, pinStory, returnToDraft, saveStory, scheduleStory } from "../../actions";
import { CoverField } from "@/components/CoverField";
import { parseFocus, focusStyle } from "@/lib/focus";
import { RichTextEditor } from "@/components/RichTextEditor";
import { StoryBody } from "@/components/StoryBody";
import { MemberBacklink } from "@/components/MemberBacklink";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function StoryEditor(props: PageProps<"/console/stories/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const isNew = id === "new";

  // arrived from the calendar view — go back there after scheduling, not to the board
  const backTo = sp.from === "calendar"
    ? `/console/stories?view=calendar${/^\d{4}-\d{2}$/.test(String(sp.month ?? "")) ? `&month=${sp.month}` : ""}`
    : "/console/stories";

  // Keep a malformed id a 404 rather than an invalid-uuid throw from must().
  if (!isNew && !UUID_RE.test(id)) notFound();

  const [story, cats, members, inds] = await Promise.all([
    isNew
      ? Promise.resolve(null)
      : must(db.from("stories").select("*, member:members!stories_member_id_fkey(name, logo_path, slug, status, industry_id)").eq("id", id).maybeSingle(), "console/stories editor"),
    must(db.from("categories").select("id, name").order("name"), "console/stories categories"),
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/stories members"),
    must(db.from("industries").select("id, name").order("sort_order"), "console/stories industries"),
  ]);
  if (!isNew && !story) notFound();
  const selectedCats = isNew
    ? []
    : await must(db.from("story_categories").select("category_id").eq("story_id", id), "console/stories selected categories");
  const selected = new Set((selectedCats ?? []).map((c) => c.category_id));
  const cover = mediaUrl(story?.cover_path);
  const focus = parseFocus(story?.cover_focus);
  const isPinned = !!story?.pinned_until && new Date(story.pinned_until) > new Date();
  // Same rule the video editor uses: an industry set on the row wins, otherwise
  // fall back to the subject member's — which is what migration 20260909000002
  // backfilled, and is right for the stories written before this field existed.
  const industryDefault = story?.industry_id ?? story?.member?.industry_id ?? "";

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={backTo} className="text-sm text-graphite hover:text-ink">← Story Engine</Link>
      <div className="flex items-baseline justify-between">
        <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New story" : "Edit story"}</h1>
        {!isNew && (
          <Link href={`/console/pages?type=story&entity=${id}`} className="text-sm text-graphite underline">
            Page layout for this story
          </Link>
        )}
      </div>
      {story?.status === "rejected" && (
        <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">Rejected: {story.rejected_reason}</p>
      )}
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveStory} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <UnsavedChangesGuard />
        {!isNew && <input type="hidden" name="id" value={id} />}
        <div>
          <label htmlFor="title" className="text-sm font-medium">Title</label>
          <input id="title" name="title" defaultValue={story?.title ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label htmlFor="excerpt" className="text-sm font-medium">Excerpt</label>
          <textarea id="excerpt" name="excerpt" defaultValue={story?.excerpt ?? ""} rows={2} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <span className="block text-sm font-medium">Body</span>
          <RichTextEditor name="body" ariaLabel="Body" initialHtml={story?.body ?? ""} uploadImage={consoleUploadImage} allowAdBreak minHeightClass="min-h-80" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Subject member (adds backlink + branding)</label>
            <select id="member_id" name="member_id" defaultValue={story?.member_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_member_news" defaultChecked={story?.is_member_news ?? false} />
            Member news (badged on the site)
          </label>
          <div>
            {/* stories.industry_id has existed since 20260909000002, which
                backfilled it from the subject member, but nothing could set it
                afterwards — no form wrote the column. Distinct from Categories
                below: that is the news-topic list, many per story. */}
            <label htmlFor="industry_id" className="text-sm font-medium">Industry</label>
            <select id="industry_id" name="industry_id" defaultValue={industryDefault} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {(inds ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-graphite">Drives /industry/* listings and the industry filter.</p>
          </div>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Categories</legend>
          <div className="mt-1 flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded border p-2 text-sm">
            {(cats ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-1.5">
                <input type="checkbox" name="categories" value={c.id} defaultChecked={selected.has(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        <CoverField cover={cover} focus={focus} hint="Landscape works best: at least 1200×675px (16:9), JPG/PNG/WebP, max 8MB. Leaving this empty keeps the current image. The crop fixes lost heads — it applies on the story page, the news cards and the homepage." />
        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Save</SubmitButton>
      </form>

      {!isNew && story && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {story.status === "awaiting_approval" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Approval</h2>
              <p className="mt-1 text-xs text-graphite">Publishes immediately. To approve for a later date instead, use Schedule below.</p>
              <div className="mt-3 flex gap-2">
                <form action={decideStory}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="rounded bg-success px-4 py-2 text-sm text-white">Approve & publish</button>
                </form>
              </div>
              <form action={decideStory} className="mt-3 flex gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="decision" value="reject" />
                <input name="reason" placeholder="Reason (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
                <button className="rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Reject</button>
              </form>
            </div>
          )}
          {(story.status === "draft" || story.status === "rejected" || story.status === "scheduled" || story.status === "awaiting_approval") && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Schedule</h2>
              <form action={scheduleStory} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="return_to" value={backTo} />
                <input type="datetime-local" name="scheduled_at" defaultValue={story.scheduled_at?.slice(0, 16) ?? ""} className="rounded border px-3 py-1.5 text-sm" />
                <button className="rounded bg-ink px-4 py-2 text-sm text-white">Schedule</button>
                <button name="mode" value="now" className="rounded bg-brand px-4 py-2 text-sm font-semibold text-ink">Publish now (urgent)</button>
              </form>
              <p className="mt-2 text-xs text-graphite">
                {story.status === "awaiting_approval" && "Scheduling or publishing here also approves the story. "}
                Social push follows publication after the configured delay; daily cap applies.
              </p>
            </div>
          )}
          {story.status === "published" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Pin to headline</h2>
              <p className="mt-1 text-xs text-graphite">Pinned stories take over the homepage headline slot.</p>
              <form action={pinStory} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="id" value={id} />
                {isPinned ? (
                  <>
                    <p className="text-xs text-graphite">Pinned until {new Date(story.pinned_until!).toLocaleString("en-GB")}</p>
                    <input type="hidden" name="days" value="0" />
                    <button className="rounded border px-3 py-1.5">Unpin</button>
                  </>
                ) : (
                  <>
                    <input type="number" name="days" defaultValue={2} min={1} max={30} className="w-16 rounded border px-2 py-1.5" />
                    <span className="text-xs text-graphite">days</span>
                    <button className="rounded bg-ink px-3 py-1.5 text-white">Pin</button>
                  </>
                )}
              </form>
              {/* Return to draft was previously reachable only by dragging the
                  card on the board — the matrix allowed it, no button offered
                  it (fix list). */}
              <form action={returnToDraft} className="mt-4 border-t pt-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="kind" value="story" />
                <button className="rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Return to draft</button>
                <p className="mt-1 text-xs text-graphite">Takes it off the site straight away. The member is not emailed.</p>
              </form>
            </div>
          )}
          {story.member && (
            <div className="rounded-xl bg-white p-5 shadow-sm text-sm sm:col-span-2">
              <h2 className="font-bold text-ink">Member preview</h2>
              <p className="mt-1 text-xs text-graphite">How this story will look once published.</p>
              <div className="mt-3 rounded-lg border bg-paper p-4">
                <h3 className="text-lg font-bold leading-tight text-ink">{story.title}</h3>
                {cover && (
                  <div className="relative mt-3 h-48 overflow-hidden rounded">
                    <Image src={cover} alt="" fill sizes="100vw" style={focusStyle(story.cover_focus)} className="object-cover" unoptimized />
                  </div>
                )}
                <StoryBody segments={[story.body ?? ""]} breaks={[]} className="mt-4" />
                {["active", "grace"].includes(story.member.status) && (
                  <MemberBacklink name={story.member.name} slug={story.member.slug} logoUrl={mediaUrl(story.member.logo_path)} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
