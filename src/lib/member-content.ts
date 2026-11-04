import { isMemberDraft } from "@/lib/story-board";

/**
 * What a member may do with their own content, in one place. The edit pages,
 * the dashboard actions, submission intake and the content lifecycle's
 * withdraw all ask here. They used to keep four copies of the status list.
 *
 * Editable: content they wrote that is waiting on a decision or was sent back,
 * plus (stories only) their own unsubmitted draft (Jas 13/10). Never something
 * live, scheduled or withdrawn. And never content the desk wrote about them
 * (source other than 'member'), in any state: an admin's draft that merely
 * names them, or the desk's video waiting on approval, is the desk's work
 * (Luiza, 16 Oct: "the desk's work stays the desk's"; extended to videos and
 * events 3 Nov). For stories the same line is drawn by the preview
 * (lib/story-preview ownerMayPreview) and the member_read_own_stories policy
 * (20261016000020).
 *
 * Equipment ("machine") is outside submission intake and keeps its older rule:
 * owner and status only.
 */
export type MemberContentKind = "story" | "video" | "event" | "machine";

export const MEMBER_EDITABLE_STATUSES = ["awaiting_approval", "rejected"] as const;

type AccessRow = { member_id: string | null; status: string; member_draft?: boolean | null; source?: string | null };

const editableStatus = (status: string) => (MEMBER_EDITABLE_STATUSES as readonly string[]).includes(status);

/** Theirs to change: they are the subject AND they wrote it. A member draft is always source 'member' (stories_member_draft_check). */
function memberWrote(kind: MemberContentKind, row: AccessRow, memberId: string): boolean {
  if (row.member_id !== memberId) return false;
  return kind === "machine" || row.source === "member";
}

export function memberCanEdit(kind: MemberContentKind, row: AccessRow | null | undefined, memberId: string): boolean {
  if (!row || !memberWrote(kind, row, memberId)) return false;
  return (kind === "story" && isMemberDraft(row)) || editableStatus(row.status);
}

/** Withdraw: submitted, still waiting on (or sent back from) a decision. Never a story draft, which is deleted instead. */
export function memberCanWithdraw(kind: MemberContentKind, row: AccessRow | null | undefined, memberId: string): boolean {
  if (!row || !memberWrote(kind, row, memberId)) return false;
  if (kind === "story" && isMemberDraft(row)) return false;
  return editableStatus(row.status);
}

/** Only their own unsubmitted story draft can be deleted outright; anything submitted is withdrawn instead. */
export function memberCanDeleteStory(story: AccessRow | null | undefined, memberId: string): boolean {
  return Boolean(story && memberWrote("story", story, memberId) && isMemberDraft(story));
}

const changed = (noun: string) =>
  `This ${noun} changed after you opened it — the SMI editor may have approved, edited or sent it back. Nothing was saved; here is where it stands now.`;

/**
 * Said when a member's write finds the item no longer in the state their page
 * showed: the desk approved, edited, scheduled or sent it back in between, or
 * they changed it in another tab. Nothing is written in that case.
 */
export const MEMBER_CHANGED_ERROR = {
  story: changed("story"),
  video: changed("video"),
  event: changed("event"),
} as const;

export const STORY_CHANGED_ERROR = MEMBER_CHANGED_ERROR.story;

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
