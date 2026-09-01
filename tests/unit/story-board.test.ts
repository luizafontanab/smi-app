import { describe, expect, it } from "vitest";
import { BOARD_STATUSES, canMoveStory, isBoardStatus, LEGAL_STORY_MOVES } from "@/lib/story-board";

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
