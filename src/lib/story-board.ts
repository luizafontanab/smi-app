/**
 * Story Engine kanban: shared, pure logic.
 *
 * Kept free of Next and Supabase imports so it unit-tests directly — same
 * rationale as dev-tasks.ts: the server actions around this end in
 * redirect(), which throws NEXT_REDIRECT and cannot be exercised from vitest.
 *
 * Unlike the dev board, a story's status transitions are not all equally
 * legal — dragging must be a second entry point into the same approve/
 * reject/publish code paths the existing buttons use, never a way around
 * them (a reject needs a reason and notifies the member; approving and
 * publishing both fire the social push + notify_member jobs). The matrix
 * below is exactly what scheduleStory/decideStory already permit.
 */

export const BOARD_STATUSES = ["draft", "awaiting_approval", "scheduled", "published"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const LEGAL_STORY_MOVES: Record<BoardStatus, readonly BoardStatus[]> = {
  // draft rows are always admin-authored (member submissions start at
  // awaiting_approval), so "publish now" here never skips a member's approval.
  draft: ["awaiting_approval", "published"],
  // reject needs a reason and notifies the member — keep that on the
  // dedicated Reject form, not as a drag target.
  awaiting_approval: ["published"],
  scheduled: ["draft", "published"],
  // unpublish/take down — a capability the buttons don't offer today, but a
  // legitimate admin action once drag exists.
  published: ["draft"],
};

export function isBoardStatus(value: string): value is BoardStatus {
  return (BOARD_STATUSES as readonly string[]).includes(value);
}

export function canMoveStory(from: string, to: string): to is BoardStatus {
  return isBoardStatus(from) && isBoardStatus(to) && LEGAL_STORY_MOVES[from].includes(to);
}
