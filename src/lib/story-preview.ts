import type { CurrentUser } from "@/lib/auth";
import { isMemberDraft } from "@/lib/story-board";

/**
 * Who may open /preview/story/[id] — the unpublished story rendered exactly as
 * it will publish (Jas 13/10 items 10/15). The route reads with the service
 * role, which bypasses RLS, so this function is the whole permission check and
 * is deliberately the only one.
 *
 *   · Admins: any unpublished story — except a member's private draft, which
 *     isn't the desk's until it is submitted (lib/story-board isMemberDraft).
 *   · The member who owns it (stories.member_id): while it is theirs to work on
 *     or look back at — their draft, waiting, sent back or withdrawn. Not a
 *     story an admin drafted about them: that is the desk's work in progress.
 *   · A member merely tagged on the story: never. Anonymous: never.
 *
 * A published story isn't previewed at all: the route sends whoever could have
 * previewed it — an admin, or the member it is about — to /news
 * (redirectsToLiveStory). Before 16 Oct the permission check ran first and,
 * since nobody may preview a published story, an owner whose preview tab
 * outlived the approval got a 404 instead of their live story.
 */
const OWNER_PREVIEW_STATUSES = ["awaiting_approval", "rejected", "withdrawn"];

export type PreviewableStory = {
  status: string;
  member_id: string | null;
  source: string;
  member_draft: boolean | null;
};

export function canPreviewStory(user: CurrentUser | null, story: PreviewableStory): boolean {
  if (!user) return false;
  if (user.role === "admin") return !isMemberDraft(story);
  if (user.role !== "member" || !user.memberId || story.member_id !== user.memberId) return false;
  return ownerMayPreview(story);
}

/**
 * A story that has published since the preview link was opened: the people the
 * link was for are sent to the live page. Anyone else still gets the 404 every
 * refusal gets, so an id can't be probed for what it is.
 */
export function redirectsToLiveStory(user: CurrentUser | null, story: Pick<PreviewableStory, "status" | "member_id">): boolean {
  if (!user || story.status !== "published") return false;
  if (user.role === "admin") return true;
  return user.role === "member" && Boolean(user.memberId) && story.member_id === user.memberId;
}

/** The owner half of the rule, for lists that already know the row is theirs. */
export function ownerMayPreview(story: Pick<PreviewableStory, "status" | "source" | "member_draft">): boolean {
  if (isMemberDraft(story)) return true;
  return story.source === "member" && OWNER_PREVIEW_STATUSES.includes(story.status);
}

/** Where the preview bar's "back to editing" link goes, per viewer. */
export function previewBackHref(user: CurrentUser, storyId: string): string {
  return user.role === "admin" ? `/console/stories/${storyId}` : `/dashboard/story/${storyId}/edit`;
}
