import { isMemberDraft } from "@/lib/story-board";

/**
 * What a member may do with one of their own stories, in one place — the edit
 * page and the dashboard actions both ask, and they used to keep separate
 * copies of the status list.
 *
 * Editable: their own unsubmitted draft (Jas 13/10), or a story they wrote
 * that is waiting on a decision or was sent back. Never something live,
 * scheduled or withdrawn — and never a story the desk wrote about them
 * (source other than 'member'), in any state: an admin's draft that merely
 * names them as the subject, or an admin's story waiting on approval, is the
 * desk's work (Luiza, 16 Oct: "the desk's work stays the desk's"). The same
 * line is drawn by the preview (lib/story-preview ownerMayPreview) and by the
 * member_read_own_stories policy (20261016000020).
 */
export const MEMBER_EDITABLE_STORY_STATUSES = ["awaiting_approval", "rejected"] as const;

type StoryAccessRow = { member_id: string | null; status: string; member_draft?: boolean | null; source?: string | null };

/** Theirs to change: they are the subject AND they wrote it. A member draft is always source 'member' (stories_member_draft_check). */
function memberWroteStory(story: StoryAccessRow, memberId: string): boolean {
  return story.member_id === memberId && story.source === "member";
}

export function memberCanEditStory(story: StoryAccessRow | null | undefined, memberId: string): boolean {
  if (!story || !memberWroteStory(story, memberId)) return false;
  return isMemberDraft(story) || (MEMBER_EDITABLE_STORY_STATUSES as readonly string[]).includes(story.status);
}

/** Withdraw: a story they wrote and submitted, still waiting on (or sent back from) a decision — never a draft, which is deleted instead. */
export function memberCanWithdrawStory(story: StoryAccessRow | null | undefined, memberId: string): boolean {
  if (!story || !memberWroteStory(story, memberId) || isMemberDraft(story)) return false;
  return (MEMBER_EDITABLE_STORY_STATUSES as readonly string[]).includes(story.status);
}

/** Only their own unsubmitted draft can be deleted outright; anything submitted is withdrawn instead. */
export function memberCanDeleteStory(story: StoryAccessRow | null | undefined, memberId: string): boolean {
  return Boolean(story && memberWroteStory(story, memberId) && isMemberDraft(story));
}

/**
 * Said when a member's write finds the story no longer in the state their page
 * showed — the desk approved, edited, scheduled or sent it back in between, or
 * they changed it in another tab. Nothing is written in that case.
 */
export const STORY_CHANGED_ERROR =
  "This story changed after you opened it — the SMI editor may have approved, edited or sent it back. Nothing was saved; here is where it stands now.";

/**
 * The images a member's draft body uploaded, as storage paths: every image
 * URL in the body that points into the media bucket under this member's own
 * story prefix (memberUploadImage stores at stories/<member id>/). Anything
 * else — an image the desk placed, another member's, an external URL — is
 * never offered for deletion. Deduplicated.
 */
export function memberStoryImagePaths(body: string | null | undefined, memberId: string): string[] {
  if (!body || !memberId) return [];
  const prefix = `stories/${memberId}/`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`/storage/v1/object/public/media/(${prefix}[0-9a-z]+\\.(?:jpg|png|webp|gif|avif))(?![0-9A-Za-z._/-])`, "g");
  return [...new Set([...body.matchAll(re)].map((m) => m[1]))];
}
