import { describe, expect, it } from "vitest";
import { BOARD_STATUSES, canMoveVideo, COLUMN_LABELS, isBoardStatus, LEGAL_VIDEO_MOVES } from "@/lib/video-board";

// Mirrors tests/unit/story-board.test.ts. The two matrices are separate modules
// on purpose (events already has a different column set), so each needs its own
// cover — a shared test would hide a drift between them.

describe("isBoardStatus", () => {
  it("accepts every known status", () => {
    for (const status of BOARD_STATUSES) expect(isBoardStatus(status)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isBoardStatus("bogus")).toBe(false);
    expect(isBoardStatus("")).toBe(false);
    // withdrawn and rejected are real content_status values but have no column
    expect(isBoardStatus("withdrawn")).toBe(false);
    expect(isBoardStatus("rejected")).toBe(false);
  });
});

describe("canMoveVideo", () => {
  it("allows every move listed in LEGAL_VIDEO_MOVES", () => {
    for (const from of BOARD_STATUSES) {
      for (const to of LEGAL_VIDEO_MOVES[from]) {
        expect(canMoveVideo(from, to)).toBe(true);
      }
    }
  });

  it("rejects a reject-style move: awaiting_approval can only go to published", () => {
    expect(canMoveVideo("awaiting_approval", "draft")).toBe(false);
    expect(canMoveVideo("awaiting_approval", "scheduled")).toBe(false);
  });

  // The fix-list item this board exists for: a published video had no route back.
  it("allows published back to draft, and nowhere else", () => {
    expect(canMoveVideo("published", "draft")).toBe(true);
    expect(canMoveVideo("published", "scheduled")).toBe(false);
    expect(canMoveVideo("published", "awaiting_approval")).toBe(false);
  });

  it("rejects moving a card onto its own column", () => {
    for (const status of BOARD_STATUSES) expect(canMoveVideo(status, status)).toBe(false);
  });

  it("rejects unknown statuses on either side", () => {
    expect(canMoveVideo("bogus", "draft")).toBe(false);
    expect(canMoveVideo("draft", "bogus")).toBe(false);
    expect(canMoveVideo("bogus", "also-bogus")).toBe(false);
  });
});

describe("COLUMN_LABELS", () => {
  it("labels every column the board renders", () => {
    for (const status of BOARD_STATUSES) expect(COLUMN_LABELS[status]).toBeTruthy();
  });
});
