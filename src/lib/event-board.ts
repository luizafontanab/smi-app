/**
 * Events kanban: shared, pure logic. Mirrors story-board.ts — kept free of
 * Next and Supabase imports so it unit-tests directly.
 *
 * Events have no "scheduled" status and no pin feature, so this table is
 * smaller than LEGAL_STORY_MOVES. Same rule applies though: dragging must be
 * a second entry point into the same approve/publish code decideEvent
 * already permits, never a way around it (a reject needs a reason and
 * notifies the member — that stays on the dedicated Reject form).
 */

export const BOARD_STATUSES = ["awaiting_approval", "draft", "published"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const LEGAL_EVENT_MOVES: Record<BoardStatus, readonly BoardStatus[]> = {
  // draft events are always admin-authored (member submissions start at
  // awaiting_approval), so publishing directly from draft never skips a
  // member's approval.
  draft: ["published"],
  // reject needs a reason and notifies the member — keep that on the
  // dedicated Reject form, not as a drag/dropdown target.
  awaiting_approval: ["published"],
  published: ["draft"],
};

/** What the events console calls each status, including Rejected (off the board). */
export const EVENT_STATUS_LABELS: Record<BoardStatus | "rejected", string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  published: "Published",
  rejected: "Rejected",
};

export function isBoardStatus(value: string): value is BoardStatus {
  return (BOARD_STATUSES as readonly string[]).includes(value);
}

export function canMoveEvent(from: string, to: string): to is BoardStatus {
  return isBoardStatus(from) && isBoardStatus(to) && LEGAL_EVENT_MOVES[from].includes(to);
}
