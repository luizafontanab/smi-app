import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { mediaUrl } from "@/lib/db/server";
import { storyImage } from "@/lib/story-image";
import { storyForPreview } from "@/lib/queries";
import { loadStoryPageData } from "@/lib/story-page";
import { canPreviewStory, previewBackHref, redirectsToLiveStory } from "@/lib/story-preview";
import { STORY_STATUS_LABELS, isMemberDraft, type ListStatus } from "@/lib/story-board";
import { UUID_RE } from "@/lib/validate";
import { StoryView } from "@/components/design-option";

export const dynamic = "force-dynamic";

/**
 * Static on purpose: generateMetadata would read the story before the
 * permission check below, and a draft's title must not leak into the <title>
 * of a page someone isn't allowed to see. Never indexed (robots.ts disallows
 * /preview/ too).
 */
export const metadata: Metadata = {
  title: "Story preview",
  robots: { index: false, follow: false },
};

/**
 * An unpublished story rendered exactly as it will publish — the same
 * StoryView (design-option hook point) as /news/[slug], inside the same public chrome, with the
 * admin's layout around it (Jas 13/10 items 10/15: the old previews were
 * simplified re-renders that didn't match the real page).
 *
 * What differs from the public page, and why:
 *   · advert slots show their footprints only — no real creative mounts, so no
 *     impression is ever counted for a page no reader saw;
 *   · no story_view is recorded, no JSON-LD, no viewed-categories cookie;
 *   · a bar on top says it's a preview and links back to the editor.
 */
export default async function StoryPreviewPage(props: PageProps<"/preview/story/[id]">) {
  const { id } = await props.params;
  if (!UUID_RE.test(id)) notFound();
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/preview/story/${id}`)}`);

  const story = await storyForPreview(id);
  // Published since the link was opened: its owner or an admin goes to the
  // live page. Checked before the permission test, which no published story
  // passes — that order used to 404 the owner of a freshly approved story.
  if (story && redirectsToLiveStory(user, story)) redirect(`/news/${story.slug}`);
  // Not found and not allowed look the same, so an id can't be probed.
  if (!story || !canPreviewStory(user, story)) notFound();

  const data = await loadStoryPageData(story, { preview: true });
  const cats = (story.categories ?? []).map((c) => c.category).filter(Boolean) as { slug: string; name: string }[];
  const pic = storyImage(story);

  const statusLabel = isMemberDraft(story)
    ? "Draft — only you can see it"
    : STORY_STATUS_LABELS[story.status as ListStatus] ?? story.status;
  // A withdrawn story has no editor to go back to; the member's list does.
  const back = user.role !== "admin" && story.status === "withdrawn" ? "/dashboard/submissions" : previewBackHref(user, story.id);

  return (
    <>
      <div role="status" data-part="story-preview-bar" className="border-b-2 border-brand bg-brand/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-ink">
          <p>
            <strong>Preview</strong> · {statusLabel}. Readers can&apos;t see this page; this is how it will look once published.
          </p>
          <Link href={back} className="font-medium underline">← Back to editing</Link>
        </div>
      </div>
      <div data-part="story-page" className="mx-auto max-w-4xl px-4 lg:max-w-6xl">
        <StoryView
          story={story}
          categories={cats}
          cover={mediaUrl(pic?.path)}
          coverIsLogo={pic?.logo}
          members={data.members}
          socialPosts={story.social_posts}
          data={data}
          path={`/preview/story/${story.id}`}
        />
      </div>
    </>
  );
}
