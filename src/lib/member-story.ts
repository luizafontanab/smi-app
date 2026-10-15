import { isMemberDraft } from "@/lib/story-board";

/**
 * What a member may do with one of their own stories, in one place — the edit
 * page and the dashboard actions both ask, and they used to keep separate
 * copies of the status list.
 *
 * Editable: their own unsubmitted draft (Jas 13/10), anything waiting on a
 * decision, or anything sent back. Never something live, scheduled or
 * withdrawn — and never an admin's draft that merely names them as the
 * subject (status 'draft' without member_draft), which is the desk's work.
 */
export const MEMBER_EDITABLE_STORY_STATUSES = ["awaiting_approval", "rejected"] as const;

type StoryAccessRow = { member_id: string | null; status: string; member_draft?: boolean | null };

export function memberCanEditStory(story: StoryAccessRow | null | undefined, memberId: string): boolean {
  if (!story || story.member_id !== memberId) return false;
  return isMemberDraft(story) || (MEMBER_EDITABLE_STORY_STATUSES as readonly string[]).includes(story.status);
}

/** Only their own unsubmitted draft can be deleted outright; anything submitted is withdrawn instead. */
export function memberCanDeleteStory(story: StoryAccessRow | null | undefined, memberId: string): boolean {
  return Boolean(story && story.member_id === memberId && isMemberDraft(story));
}
