/**
 * Video Engine kanban: shared, pure logic. Sibling of `story-board.ts`, and
 * deliberately a separate module rather than a generic one parameterised over
 * content type — the two matrices are the same today only by coincidence, and
 * events (three columns, no `scheduled`) already proves the shapes diverge.
 * Kept free of Next and Supabase imports so it unit-tests directly.
 *
 * As with stories, dragging must be a second entry point into the same
 * approve/publish code paths the buttons use, never a way around them: a
 * publish fires the social push and the `video_live` notification, and an
 * approval writes an `approvals` row. The matrix below is exactly what
 * scheduleVideo/decideVideo already permit.
 */

export const BOARD_STATUSES = ["draft", "awaiting_approval", "scheduled", "published"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const COLUMN_LABELS: Record<BoardStatus, string> = {
  awaiting_approval: "Ready to review",
  draft: "Drafts",
  scheduled: "Scheduled",
  published: "Live",
};

export const LEGAL_VIDEO_MOVES: Record<BoardStatus, readonly BoardStatus[]> = {
  // draft rows are admin-authored (member submissions start at
  // awaiting_approval), so "publish now" here never skips a member's approval.
  draft: ["awaiting_approval", "published"],
  // "Not yet" sends an admin's own video back to draft; a member's needs the
  // Send back form (reason + email), so moveVideo refuses it — as for stories.
  awaiting_approval: ["draft", "published"],
  scheduled: ["draft", "published"],
  // unpublish/take down. Videos had no route back from published at all before
  // this (fix list) — not by drag, and not by any button.
  published: ["draft"],
};

export function isBoardStatus(value: string): value is BoardStatus {
  return (BOARD_STATUSES as readonly string[]).includes(value);
}

export function canMoveVideo(from: string, to: string): to is BoardStatus {
  return isBoardStatus(from) && isBoardStatus(to) && LEGAL_VIDEO_MOVES[from].includes(to);
}

/** Where Schedule and "Publish now" may start from, as story-board's SCHEDULABLE_FROM: never Live or Withdrawn. */
export const SCHEDULABLE_FROM = ["draft", "awaiting_approval", "rejected", "scheduled"] as const;

export function canScheduleVideo(from: string): boolean {
  return (SCHEDULABLE_FROM as readonly string[]).includes(from);
}
