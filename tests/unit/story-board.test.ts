import { describe, expect, it } from "vitest";
import {
  BOARD_STATUSES, canMoveStory, isBoardStatus, LEGAL_STORY_MOVES,
  parseStoryListFilters, parseStoryView, storyEditorHrefFromList, storyListHref,
} from "@/lib/story-board";

describe("isBoardStatus", () => {
  it("accepts every known status", () => {
    for (const status of BOARD_STATUSES) expect(isBoardStatus(status)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isBoardStatus("bogus")).toBe(false);
    expect(isBoardStatus("")).toBe(false);
  });
});

describe("canMoveStory", () => {
  it("allows every move listed in LEGAL_STORY_MOVES", () => {
    for (const from of BOARD_STATUSES) {
      for (const to of LEGAL_STORY_MOVES[from]) {
        expect(canMoveStory(from, to)).toBe(true);
      }
    }
  });

  it("rejects a reject-style move: awaiting_approval can only go to published", () => {
    expect(canMoveStory("awaiting_approval", "draft")).toBe(false);
    expect(canMoveStory("awaiting_approval", "scheduled")).toBe(false);
  });

  it("rejects moving a card onto its own column", () => {
    for (const status of BOARD_STATUSES) expect(canMoveStory(status, status)).toBe(false);
  });

  it("rejects unknown statuses on either side", () => {
    expect(canMoveStory("bogus", "draft")).toBe(false);
    expect(canMoveStory("draft", "bogus")).toBe(false);
    expect(canMoveStory("bogus", "also-bogus")).toBe(false);
  });
});

// fix-list 75: the list view.
describe("parseStoryView", () => {
  it("recognises board, calendar and list", () => {
    expect(parseStoryView("calendar")).toBe("calendar");
    expect(parseStoryView("list")).toBe("list");
  });

  it("falls back to the board for anything else, including nothing", () => {
    expect(parseStoryView(undefined)).toBe("board");
    expect(parseStoryView("grid")).toBe("board");
    expect(parseStoryView(["list"])).toBe("board");
  });
});

describe("parseStoryListFilters", () => {
  it("accepts every story status, including the two the board never shows", () => {
    expect(parseStoryListFilters({ status: "rejected" }).status).toBe("rejected");
    expect(parseStoryListFilters({ status: "withdrawn" }).status).toBe("withdrawn");
  });

  it("defaults an unknown status to all, and a bad page to 1", () => {
    expect(parseStoryListFilters({ status: "bogus", page: "0" })).toEqual({ status: "all", page: 1 });
    expect(parseStoryListFilters({ page: "2.5" })).toEqual({ status: "all", page: 1 });
    expect(parseStoryListFilters({ page: "3" })).toEqual({ status: "all", page: 3 });
  });
});

describe("storyListHref / storyEditorHrefFromList", () => {
  it("keeps the filter and page in the URL, and leaves defaults out", () => {
    expect(storyListHref({ status: "all", page: 1 })).toBe("/console/stories?view=list");
    expect(storyListHref({ status: "published", page: 3 })).toBe("/console/stories?view=list&status=published&page=3");
    expect(storyListHref({ status: "published", page: 3 }, { page: 1 })).toBe("/console/stories?view=list&status=published");
  });

  it("round-trips through the editor so Back returns to the same list page", () => {
    const filters = { status: "scheduled", page: 2 } as const;
    const editor = new URL(storyEditorHrefFromList("s1", filters), "http://x");
    expect(editor.pathname).toBe("/console/stories/s1");
    expect(editor.searchParams.get("from")).toBe("list");
    const back = storyListHref(parseStoryListFilters(Object.fromEntries(editor.searchParams)));
    expect(back).toBe(storyListHref(filters));
  });

  it("produces a URL the story actions' return_to allowlist accepts", () => {
    // mirrors the regex in scheduleStory (src/app/console/actions.ts)
    const allow = /^\/console\/stories(\?[\w=&-]*)?$/;
    expect(allow.test(storyListHref({ status: "awaiting_approval", page: 4 }))).toBe(true);
  });
});
