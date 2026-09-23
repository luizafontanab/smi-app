import { describe, expect, it } from "vitest";
import { BOARD_STATUSES, canMoveEvent, isBoardStatus, LEGAL_EVENT_MOVES } from "@/lib/event-board";

describe("isBoardStatus", () => {
  it("accepts every known status", () => {
    for (const status of BOARD_STATUSES) expect(isBoardStatus(status)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isBoardStatus("bogus")).toBe(false);
    expect(isBoardStatus("rejected")).toBe(false);
    expect(isBoardStatus("")).toBe(false);
  });
});

describe("canMoveEvent", () => {
  it("allows every move listed in LEGAL_EVENT_MOVES", () => {
    for (const from of BOARD_STATUSES) {
      for (const to of LEGAL_EVENT_MOVES[from]) {
        expect(canMoveEvent(from, to)).toBe(true);
      }
    }
  });

  it("rejects a reject-style move: awaiting_approval can only go to published", () => {
    expect(canMoveEvent("awaiting_approval", "draft")).toBe(false);
  });

  it("rejects moving a card onto its own column", () => {
    for (const status of BOARD_STATUSES) expect(canMoveEvent(status, status)).toBe(false);
  });

  it("rejects unknown statuses on either side", () => {
    expect(canMoveEvent("bogus", "draft")).toBe(false);
    expect(canMoveEvent("draft", "bogus")).toBe(false);
    expect(canMoveEvent("rejected", "draft")).toBe(false);
  });
});
