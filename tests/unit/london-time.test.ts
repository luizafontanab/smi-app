import { describe, expect, it } from "vitest";
import { formatLondon, londonAt, londonDayStart, londonInputValue, parseLondonInput } from "@/lib/london-time";

// Fixed instants only, so these hold on a UTC CI runner and a London laptop alike.
// 2026 clocks: forward 29 Mar 01:00 GMT → 02:00 BST; back 25 Oct 02:00 BST → 01:00 GMT.

describe("parseLondonInput", () => {
  it("reads a winter time as GMT and a summer time as BST", () => {
    expect(parseLondonInput("2026-01-15T10:00")?.toISOString()).toBe("2026-01-15T10:00:00.000Z");
    expect(parseLondonInput("2026-07-01T10:00")?.toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });

  it("moves a time skipped when the clocks go forward on by an hour", () => {
    expect(parseLondonInput("2026-03-29T01:30")?.toISOString()).toBe("2026-03-29T01:30:00.000Z"); // = 02:30 BST
    expect(parseLondonInput("2026-03-29T00:30")?.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(parseLondonInput("2026-03-29T03:00")?.toISOString()).toBe("2026-03-29T02:00:00.000Z");
  });

  it("takes the first (BST) of a time that happens twice when the clocks go back", () => {
    expect(parseLondonInput("2026-10-25T01:30")?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(parseLondonInput("2026-10-25T00:30")?.toISOString()).toBe("2026-10-24T23:30:00.000Z");
    expect(parseLondonInput("2026-10-25T02:30")?.toISOString()).toBe("2026-10-25T02:30:00.000Z");
  });

  it("refuses anything that isn't a datetime-local value", () => {
    for (const bad of ["", "tomorrow", "2026-07-01", "2026-07-01T25:00", "2026-02-31T10:00", "2026-07-01T10:00Z"]) {
      expect(parseLondonInput(bad)).toBeNull();
    }
  });
});

describe("londonInputValue", () => {
  it("shows a stored instant as UK wall-clock time, and round-trips through the parser", () => {
    expect(londonInputValue("2026-07-01T09:00:00Z")).toBe("2026-07-01T10:00");
    expect(londonInputValue("2026-01-15T10:00:00Z")).toBe("2026-01-15T10:00");
    for (const v of ["2026-07-01T10:00", "2026-01-15T23:45", "2026-10-25T01:30"]) {
      expect(londonInputValue(parseLondonInput(v))).toBe(v);
    }
  });

  it("is empty for nothing or junk", () => {
    expect(londonInputValue(null)).toBe("");
    expect(londonInputValue("not a date")).toBe("");
  });
});

describe("London days", () => {
  it("starts the day at London midnight, even when UTC is still on the day before", () => {
    expect(londonDayStart(new Date("2026-07-01T23:30:00Z")).toISOString()).toBe("2026-07-01T23:00:00.000Z");
    expect(londonDayStart(new Date("2026-01-15T12:00:00Z")).toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("steps whole calendar days across a clock change", () => {
    expect(londonAt(new Date("2026-10-24T12:00:00Z"), 1, 9).toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(londonAt(new Date("2026-03-28T12:00:00Z"), 1, 9).toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });

  it("formats in UK time", () => {
    expect(formatLondon("2026-07-01T09:00:00Z")).toContain("10:00");
  });
});
