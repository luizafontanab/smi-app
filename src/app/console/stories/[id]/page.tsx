import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { renderableHtml } from "@/lib/sanitize";
import { consoleUploadImage, decideStory, pinStory, returnToDraft, saveStory, scheduleStory, searchBiginCompanies, setStoryStatus, confirmStorySocial } from "../../actions";
import { CoverField } from "@/components/CoverField";
import { parseFocus } from "@/lib/focus";
import { RichTextEditor } from "@/components/RichTextEditor";
import { InlineStoryPreview } from "@/components/story/InlineStoryPreview";
import { MemberTagPicker } from "@/components/console/MemberTagPicker";
import { ClosingLinksPicker } from "@/components/console/ClosingLinksPicker";
import { getCrmSync } from "@/lib/adapters/crm";
import { taggedMembers } from "@/lib/story-members";
import { companyLinksFor, readClosingLinks } from "@/lib/company-link";
import { StorySocialLinks } from "@/components/StorySocialLinks";
import { socialChannel, STORY_POST_CHANNELS } from "@/lib/social";
import { isMemberLinkable } from "@/lib/member-visibility";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { MirrorInput } from "@/components/console/MirrorInput";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/console/ui";
import { STORY_STATUS_LABELS, isMemberDraft, parseStoryListFilters, storyListHref } from "@/lib/story-board";
import { SocialConfirmForm, SocialPostFields } from "@/components/console/SocialPostFields";
import { CountedInput } from "@/components/console/CountedInput";
import { STORY_SUMMARY_WORDS } from "@/lib/newsletter-layout";
import { latestSocialJob, readSocialCaps } from "@/lib/social-push";
import { cachedChannelNetworks, isSocialLive } from "@/lib/adapters/social";
import { loadSocialPanel, storySocialItem } from "@/lib/social-post";
import { socialNotes, socialSummary } from "@/lib/social-confirm";
import { formatLondon, londonInputValue } from "@/lib/london-time";

export const dynamic = "force-dynamic";

export default async function StoryEditor(props: PageProps<"/console/stories/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const isNew = id === "new";

  // arrived from the calendar or list view — go back there after scheduling, not to the board
  const backTo = sp.from === "calendar"
    ? `/console/stories?view=calendar${/^\d{4}-\d{2}$/.test(String(sp.month ?? "")) ? `&month=${sp.month}` : ""}`
    : sp.from === "list"
      ? storyListHref(parseStoryListFilters(sp))
      : "/console/stories";

  // Keep a malformed id a 404 rather than an invalid-uuid throw from must().
  if (!isNew && !UUID_RE.test(id)) notFound();

  const [story, cats, allMembers, inds, socialCaps, socialJob] = await Promise.all([
    isNew
      ? Promise.resolve(null)
      : must(db.from("stories").select("*, summary:story_summary, member:members!stories_member_id_fkey(name, logo_path, slug, status, archived_at, industry_id, social), categories:story_categories(category:categories(slug, name))").eq("id", id).maybeSingle(), "console/stories editor"),
    must(db.from("categories").select("id, name").order("name"), "console/stories categories"),
    // Every member, filtered below: the pickers offer the ones with a public
    // page, plus anyone this story already names whatever their state — a
    // select whose saved value has no option posts "" and silently un-tags them.
    must(db.from("members").select("id, name, status, archived_at").order("name"), "console/stories members"),
    must(db.from("industries").select("id, name").order("sort_order"), "console/stories industries"),
    readSocialCaps(db),
    isNew ? Promise.resolve(null) : latestSocialJob(db, { story_id: id }),
  ]);
  // A member's unsubmitted draft is private to them until they submit it.
  if (!isNew && (!story || isMemberDraft(story))) notFound();
  const selectedCats = isNew
    ? []
    : await must(db.from("story_categories").select("category_id").eq("story_id", id), "console/stories selected categories");
  const selected = new Set((selectedCats ?? []).map((c) => c.category_id));
  // Started from a Story sources suggestion: the article it came from, for reference
  // while writing. Kept off the story itself so it can't go live by accident.
  const origin = isNew
    ? null
    : await must(db.from("source_items").select("url, source:content_sources(domain, label)").eq("story_id", id).limit(1).maybeSingle(), "console/stories source suggestion");
  // The article's own text, as it was before the third-person rewrite (story_originals).
  const original = isNew
    ? null
    : await must(db.from("story_originals").select("body, rewritten").eq("story_id", id).maybeSingle(), "console/stories original article");
  // every member the story features, primary first (lib/story-members)
  const tagged = isNew || !story ? [] : await taggedMembers(db, id, story.member_id);
  const taggedIds = new Set(tagged.map((m) => m.id));
  const keep = (m: { id: string }) => m.id === story?.member_id || taggedIds.has(m.id);
  const members = (allMembers ?? [])
    .filter((m) => isMemberLinkable(m) || keep(m))
    .map(({ id: mid, name, status, archived_at }) => ({
      id: mid,
      name,
      // say why a kept member has no public page, so the tag isn't a surprise
      note: archived_at ? "archived" : isMemberLinkable({ status, archived_at }) ? undefined : status,
    }));
  const cover = mediaUrl(story?.cover_path);
  const focus = parseFocus(story?.cover_focus);
  const isPinned = !!story?.pinned_until && new Date(story.pinned_until) > new Date();
  // Same rule the video editor uses: an industry set on the row wins, otherwise
  // fall back to the subject member's — which is what migration 20260909000002
  // backfilled, and is right for the stories written before this field existed.
  const industryDefault = story?.industry_id ?? story?.member?.industry_id ?? "";
  // Approve / Schedule send the Industry box as it stands, so what Jas sees is what goes Live.
  const industryField = <MirrorInput source="industry_id" name="industry_id" defaultValue={String(industryDefault)} />;
  const storedPosts = (story?.social_posts && typeof story.social_posts === "object" && !Array.isArray(story.social_posts)
    ? story.social_posts
    : {}) as Partial<Record<string, string>>;
  // Issue #43: each channel's preview, confirmation and status, built from the rows already read above.
  const socialPanel = story
    ? await loadSocialPanel(db, { story_id: id }, {
      networks: () => cachedChannelNetworks(),
      delayMinutes: socialCaps.delay_minutes,
      item: storySocialItem(story, tagged),
    })
    : null;
  const socialStatus = socialPanel ? socialSummary(socialPanel.channels.map((c) => c.state)) : undefined;
  const socialNoteLines = story ? socialNotes({ live: isSocialLive(), job: socialJob }) : [];

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
      {origin && (
        <p className="mt-2 rounded bg-white p-2 text-sm text-graphite shadow-sm">
          Started from a suggestion on {origin.source?.label ?? origin.source?.domain}:{" "}
          <a href={origin.url} target="_blank" rel="noopener noreferrer" className="break-all text-ink underline">{origin.url}</a>
        </p>
      )}
      {original && (
        <details className="mt-2 rounded bg-white p-2 text-sm shadow-sm">
          <summary className="cursor-pointer text-graphite">
            Original article text{original.rewritten ? " — the body below is its third-person rewrite" : ""}
          </summary>
          {/* Read-only reference. Sanitised on render like every story body. */}
          <div className="story-body mt-2 max-h-96 overflow-y-auto border-t pt-2" dangerouslySetInnerHTML={{ __html: renderableHtml(original.body) }} />
        </details>
      )}
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      {typeof sp.notice === "string" && (
        <div role="status" className="mt-2 rounded bg-shade p-2 text-sm text-ink">
          <p className="font-medium">Draft pre-loaded from the article. Still to do:</p>
          <ul className="mt-1 list-disc pl-5">
            {sp.notice.split("\n").filter(Boolean).map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}

      <form action={saveStory} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <UnsavedChangesGuard />
        {!isNew && <input type="hidden" name="id" value={id} />}
        <div>
          <label htmlFor="title" className="text-sm font-medium">Title</label>
          <input id="title" name="title" defaultValue={story?.title ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <CountedInput
          id="excerpt"
          name="excerpt"
          label={<>Summary <span className="font-normal text-graphite">(optional, {STORY_SUMMARY_WORDS.min}–{STORY_SUMMARY_WORDS.max} words)</span></>}
          labelClassName="text-sm font-medium"
          unit="words"
          softMin={STORY_SUMMARY_WORDS.min}
          softMax={STORY_SUMMARY_WORDS.max}
          overMessage="longer than the newsletter SOP suggests"
          multiline
          rows={3}
          defaultValue={story?.excerpt ?? ""}
          hint="Shown under the title on story cards and in newsletters, and as the description when the story is shared on social media or found in search. Left empty, the story's opening lines are used."
        />
        <div>
          <span className="block text-sm font-medium">Body</span>
          <RichTextEditor name="body" ariaLabel="Body" initialHtml={story?.body ?? ""} uploadImage={consoleUploadImage} allowAdBreak minHeightClass="min-h-80" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Subject member (adds backlink + branding)</label>
            <select id="member_id" name="member_id" defaultValue={story?.member_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.note ? ` (${m.note})` : ""}</option>)}
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
        <MemberTagPicker
          options={members}
          selected={[...taggedIds].filter((mid) => mid !== story?.member_id)}
          primarySelectId="member_id"
        />
        <ClosingLinksPicker initial={readClosingLinks(story?.closing_links)} search={searchBiginCompanies} live={getCrmSync().live} />
        <fieldset>
          <legend className="text-sm font-medium">Categories</legend>
          {/* Unticked boxes send nothing: this tells the save the box was here, so none ticked clears them. */}
          <input type="hidden" name="categories_sent" value="1" />
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
        <SocialPostFields
          item={story}
          fallback={story?.summary ?? story?.title ?? ""}
          fallbackName="summary"
          caps={socialCaps}
          panel={socialPanel}
          notes={socialNoteLines}
          confirmable={!!story}
          confirmed={typeof sp.confirmed === "string" ? sp.confirmed : undefined}
        />
        {/* Jas 13/10 item 8: the story page links readers to SMI's own post of
            the story rather than offering share buttons. Filled from Buffer once
            it has sent the post (social_links job); still editable, for a post
            made outside Buffer or a link to correct. */}
        <fieldset>
          <legend className="text-sm font-medium">SMI&apos;s posts of this story</legend>
          <p className="mt-0.5 text-xs text-graphite">
            Filled in automatically once Buffer has posted the story. Only paste a link for a post made outside Buffer. Any left empty link to SMI&apos;s page on that network instead.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {STORY_POST_CHANNELS.map((network) => {
              const ch = socialChannel(network)!;
              return (
                <div key={network}>
                  <label htmlFor={`post_${network}`} className="text-xs font-medium">{ch.label} post</label>
                  {/* what it held when this page rendered: saving an untouched field keeps a link filled in since */}
                  {!isNew && <input type="hidden" name={`post_${network}_was`} value={storedPosts[network] ?? ""} />}
                  <input
                    id={`post_${network}`}
                    name={`post_${network}`}
                    type="url"
                    inputMode="url"
                    defaultValue={storedPosts[network] ?? ""}
                    placeholder={`https://${ch.host}/…`}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  />
                </div>
              );
            })}
          </div>
        </fieldset>
        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Save</SubmitButton>
      </form>
      {story && <SocialConfirmForm action={confirmStorySocial} id={id} />}

      {!isNew && story && (
        <>
        {/* Publishing: the story's state and what can happen to it next, set
            apart from the content above and the preview below (Luiza, 15 Oct:
            "the workflow is not clear"). Flat shade panels with no shadow read
            as controls; the white, raised cards around them are content. */}
        <section aria-labelledby="publishing-heading" className="mt-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="publishing-heading" className="flex items-center gap-2 font-bold text-ink">
              <span aria-hidden className="inline-block h-3.5 w-1 shrink-0 rounded-full bg-brand" />
              Publishing
            </h2>
            <Badge tone={STATUS_TONE[story.status] ?? "neutral"}>{STATUS_LABEL[story.status] ?? story.status}</Badge>
            {isPinned && <Badge tone="brand">Pinned to headline</Badge>}
          </div>
          <p className="mt-1 text-sm text-graphite">{statusNext(story)}</p>
          <p className="mt-0.5 text-sm text-graphite">
            {socialStatus} <a href="#social" className="underline">See and confirm the social post</a>
          </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {/* Ready to review (Jas's flow chart, 16 Oct): approve, then schedule.
              Approving for a time is the main path; publishing now is the
              urgent one. "Not yet" depends on who wrote it — a member is told
              why, the desk's own story just goes back to draft. */}
          {story.status === "awaiting_approval" && (
            <div className={ACTION_PANEL}>
              <h2 className="font-bold text-ink">Approve</h2>
              <form action={scheduleStory} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="return_to" value={backTo} />
                {industryField}
                <label htmlFor="approve_at" className="sr-only">Publish at (UK time)</label>
                <input id="approve_at" type="datetime-local" name="scheduled_at" required defaultValue={londonInputValue(story.scheduled_at)} className="rounded border bg-white px-3 py-1.5 text-sm" />
                <SubmitButton pendingLabel="Approving…" className="rounded bg-success px-4 py-2 text-sm text-white">Approve & schedule</SubmitButton>
              </form>
              <form action={decideStory} className="mt-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="decision" value="approve" />
                {industryField}
                <SubmitButton pendingLabel="Publishing…" className="rounded border border-ink bg-white px-3 py-1.5 text-sm text-ink">Approve & publish now (urgent)</SubmitButton>
              </form>
              <p className="mt-2 text-xs text-graphite">
                Times are UK time. The social post follows its own time, set under Social post above. Pinning to the headline is a separate choice once it&apos;s live.
              </p>
              {story.source === "member" ? (
                <form action={decideStory} className="mt-4 flex gap-2 border-t border-black/5 pt-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="decision" value="reject" />
                  <input name="reason" aria-label="Reason (sent to the member)" placeholder="Reason (sent to the member)" required className="w-full rounded border bg-white px-3 py-1.5 text-sm" />
                  <SubmitButton pendingLabel="Sending back…" className="shrink-0 rounded border border-danger/30 bg-white px-3 py-1.5 text-sm text-danger">Send back</SubmitButton>
                </form>
              ) : (
                <form action={decideStory} className="mt-4 border-t border-black/5 pt-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="decision" value="reject" />
                  <SubmitButton pendingLabel="Returning…" className="rounded border border-black/15 bg-white px-3 py-1.5 text-sm text-ink">Not yet — back to draft</SubmitButton>
                  <p className="mt-1 text-xs text-graphite">Nobody is emailed. Edit it, then mark it ready to review again.</p>
                </form>
              )}
            </div>
          )}
          {(story.status === "draft" || story.status === "rejected" || story.status === "scheduled") && (
            <div className={ACTION_PANEL}>
              <h2 className="font-bold text-ink">Schedule</h2>
              <form action={scheduleStory} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="return_to" value={backTo} />
                {industryField}
                <label htmlFor="schedule_at" className="sr-only">Publish at (UK time)</label>
                <input id="schedule_at" type="datetime-local" name="scheduled_at" defaultValue={londonInputValue(story.scheduled_at)} className="rounded border bg-white px-3 py-1.5 text-sm" />
                <SubmitButton pendingLabel="Scheduling…" className="rounded bg-ink px-4 py-2 text-sm text-white">Schedule</SubmitButton>
                <SubmitButton pendingLabel="Publishing…" name="mode" value="now" className="rounded bg-brand px-4 py-2 text-sm font-semibold text-ink">Publish now (urgent)</SubmitButton>
              </form>
              <p className="mt-2 text-xs text-graphite">
                Times are UK time. The social post follows its own time, set under Social post above.
              </p>
              {/* Optional (Luiza, 20 Oct): a draft can still be scheduled
                  directly; this parks it for a second look first. */}
              {story.status === "draft" && (
                <form action={setStoryStatus} className="mt-4 border-t border-black/5 pt-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value="awaiting_approval" />
                  <input type="hidden" name="return_to" value={`/console/stories/${id}`} />
                  <SubmitButton pendingLabel="Marking…" className="rounded border border-black/15 bg-white px-3 py-1.5 text-sm text-ink">Mark ready to review</SubmitButton>
                  <p className="mt-1 text-xs text-graphite">Optional. Puts it in Ready to review for a final check before it&apos;s scheduled.</p>
                </form>
              )}
            </div>
          )}
          {/* Pinning is its own, optional decision — never part of approving
              (Luiza, 15 Oct: it read as if approval came with a pin). No days
              are pre-filled: an empty box can't be mistaken for a pin already
              chosen. Unpinned, the headline is simply the newest story. */}
          {story.status === "published" && (
            <div className={ACTION_PANEL}>
              <h2 className="font-bold text-ink">Pin to headline <span className="font-normal text-graphite">(optional)</span></h2>
              <p className="mt-1 text-xs text-graphite">
                {isPinned
                  ? `Pinned until ${formatLondon(story.pinned_until!)}: it holds the homepage headline until then.`
                  : "Not pinned. The homepage headline shows the newest story unless one is pinned; pin this one to hold the slot for a few days."}
              </p>
              <form action={pinStory} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <input type="hidden" name="id" value={id} />
                {isPinned ? (
                  <>
                    <input type="hidden" name="days" value="0" />
                    <SubmitButton pendingLabel="Unpinning…" className="rounded border bg-white px-3 py-1.5">Unpin</SubmitButton>
                  </>
                ) : (
                  <>
                    <label htmlFor="pin_days" className="sr-only">Days to pin</label>
                    <input id="pin_days" type="number" name="days" required min={1} max={30} placeholder="1–30" className="w-20 rounded border bg-white px-2 py-1.5" />
                    <span className="text-xs text-graphite">days</span>
                    <SubmitButton pendingLabel="Pinning…" className="rounded border border-ink bg-white px-3 py-1.5 text-ink">Pin</SubmitButton>
                  </>
                )}
              </form>
            </div>
          )}
          {story.status === "published" && (
            <div className={ACTION_PANEL}>
              <h2 className="font-bold text-ink">Take it off the site</h2>
              {/* Return to draft was previously reachable only by dragging the
                  card on the board — the matrix allowed it, no button offered
                  it (fix list). */}
              <form action={returnToDraft} className="mt-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="kind" value="story" />
                <SubmitButton pendingLabel="Returning…" className="rounded border border-danger/30 bg-white px-3 py-1.5 text-sm text-danger">Return to draft</SubmitButton>
                <p className="mt-1 text-xs text-graphite">Takes it off the site straight away. The member is not emailed.</p>
              </form>
            </div>
          )}
        </div>
        </section>

          {/* Jas 13/10 items 10/15: this used to be a separate, simplified render
              (smaller title and hero, no reading typography, raw advert-break
              markers) that didn't look like the published page. It is now the
              published page's own components; the full page — layout, advert
              slots and all — is one click away. Shown for every story, not
              only member stories: an admin's own story deserves the same check. */}
          <div className="mt-8 rounded-xl bg-white p-5 shadow-sm text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-bold text-ink">Preview</h2>
              {story.status === "published" ? (
                <a href={`/news/${story.slug}`} target="_blank" rel="noopener" className="text-sm font-medium text-ink underline">
                  View live ↗<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <a href={`/preview/story/${story.id}`} target="_blank" rel="noopener" className="text-sm font-medium text-ink underline">
                  Preview as published ↗<span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>
            <p className="mt-1 text-xs text-graphite">
              How this story will look once published, from the last saved version. The full-page preview adds the
              page&apos;s advert slots and the blocks around the article.
            </p>
            <div className="mt-3 overflow-hidden rounded-lg border bg-paper px-4 pb-4">
              <InlineStoryPreview
                story={story}
                categories={(story.categories ?? []).map((c) => c.category).filter(Boolean) as { slug: string; name: string }[]}
                cover={cover}
                body={story.body}
                share={<StorySocialLinks posts={story.social_posts} />}
                companyLinks={companyLinksFor(tagged.filter((m) => isMemberLinkable(m)), story.member_id, readClosingLinks(story.closing_links))}
                members={tagged.filter((m) => isMemberLinkable(m)).map((m) => ({ name: m.name, slug: m.slug, logoUrl: mediaUrl(m.logo_path) }))}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The Publishing panels: flat on the shade ground — controls, not content (see the section). */
const ACTION_PANEL = "rounded-xl border border-black/5 bg-shade p-5";

const STATUS_LABEL: Record<string, string> = STORY_STATUS_LABELS;

const STATUS_TONE: Record<string, "neutral" | "brand" | "green" | "red"> = {
  awaiting_approval: "brand",
  scheduled: "brand",
  published: "green",
  rejected: "red",
};

/** One line under the status: where the story stands and what can happen next. */
function statusNext(story: { status: string; source: string; scheduled_at: string | null; published_at: string | null }): string {
  const when = (iso: string | null) => (iso ? formatLondon(iso) : "");
  switch (story.status) {
    case "awaiting_approval":
      return story.source === "member"
        ? "Ready to review. Approve it for a time, publish it now, or send it back with a reason."
        : "Ready to review. Approve it for a time, publish it now, or put it back to draft.";
    case "scheduled":
      return `Goes live on ${when(story.scheduled_at)}. Change the time or publish it now below.`;
    case "published":
      return `On the site since ${when(story.published_at)}. Pinning is optional.`;
    case "rejected":
      return "Sent back to the member. They can edit and resubmit, or you can publish it below.";
    case "withdrawn":
      return "The member withdrew it. Nothing is waiting on you.";
    default:
      return "Not on the site. Schedule it or publish it below when it's ready.";
  }
}
