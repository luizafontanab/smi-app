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

/**
 * A member's own unsubmitted draft (Jas 13/10 — members can save a draft and
 * preview it before submitting). It is the member's private workspace: the
 * console never lists it, counts it, previews it or moves it. Only submitting
 * hands it over, as `awaiting_approval`. An explicit column, not status +
 * source: an admin's "Return to draft" on a member's story is the desk's
 * working copy and must stay theirs (migration 20261015000001).
 */
export function isMemberDraft(story: { member_draft?: boolean | null }): boolean {
  return story.member_draft === true;
}

export const LEGAL_STORY_MOVES: Record<BoardStatus, readonly BoardStatus[]> = {
  // The draft rows the console sees are admin-authored — member drafts are
  // filtered out of every console view (member_draft = false) and refused by
  // the move/schedule/save actions (isMemberDraft) — so "publish now" here
  // never skips a member's approval.
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

/* ---------- views (fix-list 75) ---------- */

export const STORY_VIEWS = ["board", "calendar", "list"] as const;
export type StoryView = (typeof STORY_VIEWS)[number];

/** Anything unrecognised is the board — the page's long-standing default. */
export function parseStoryView(value: unknown): StoryView {
  return (STORY_VIEWS as readonly unknown[]).includes(value) ? (value as StoryView) : "board";
}

/**
 * Every status, not just the board's four: the list is where rejected and
 * withdrawn stories can be found at all — the board fetches them and never
 * shows them.
 */
export const LIST_STATUSES = ["draft", "awaiting_approval", "scheduled", "published", "rejected", "withdrawn"] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];

export const STORY_STATUS_LABELS: Record<ListStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  scheduled: "Scheduled",
  published: "Published",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const STORY_LIST_PAGE_SIZE = 50;

export type StoryListFilters = { status: ListStatus | "all"; page: number };

type SearchParams = Record<string, string | string[] | undefined>;

export function parseStoryListFilters(sp: SearchParams): StoryListFilters {
  const status = (LIST_STATUSES as readonly unknown[]).includes(sp.status) ? (sp.status as ListStatus) : "all";
  const page = Number(sp.page);
  return { status, page: Number.isInteger(page) && page > 1 ? page : 1 };
}

/** The list view's URL, so a filter or page survives a trip to the editor and back. */
export function storyListHref(filters: StoryListFilters, patch: Partial<StoryListFilters> = {}): string {
  const f = { ...filters, ...patch };
  const params = new URLSearchParams({ view: "list" });
  if (f.status !== "all") params.set("status", f.status);
  if (f.page > 1) params.set("page", String(f.page));
  return `/console/stories?${params}`;
}

/** The editor link from a list row: carries the list state so Back returns to it. */
export function storyEditorHrefFromList(id: string, filters: StoryListFilters): string {
  const params = new URLSearchParams({ from: "list" });
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.page > 1) params.set("page", String(filters.page));
  return `/console/stories/${id}?${params}`;
}
