import { describe, expect, it } from "vitest";
import { dayKey, monthGrid, monthKey, parseMonth, shiftMonth, WEEKDAYS } from "@/lib/calendar";

describe("dayKey", () => {
  it("formats as local YYYY-MM-DD, zero-padded", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 25))).toBe("2026-12-25");
  });
});

describe("monthKey", () => {
  it("formats as local YYYY-MM, zero-padded", () => {
    expect(monthKey(new Date(2026, 0, 5))).toBe("2026-01");
    expect(monthKey(new Date(2026, 11, 25))).toBe("2026-12");
  });
});

describe("parseMonth", () => {
  it("parses a well-formed YYYY-MM into the first of that month", () => {
    expect(parseMonth("2026-03")).toEqual(new Date(2026, 2, 1));
  });

  it("falls back to the current month for an undefined value", () => {
    const now = new Date();
    expect(parseMonth(undefined)).toEqual(new Date(now.getFullYear(), now.getMonth(), 1));
  });

  it("falls back to the current month for a malformed string", () => {
    const now = new Date();
    expect(parseMonth("not-a-month")).toEqual(new Date(now.getFullYear(), now.getMonth(), 1));
    expect(parseMonth("2026/03")).toEqual(new Date(now.getFullYear(), now.getMonth(), 1));
  });

  it("falls back to the current month when the month number is out of range", () => {
    const now = new Date();
    expect(parseMonth("2026-00")).toEqual(new Date(now.getFullYear(), now.getMonth(), 1));
    expect(parseMonth("2026-13")).toEqual(new Date(now.getFullYear(), now.getMonth(), 1));
  });
});

describe("monthGrid", () => {
  it("builds five whole Mon-first weeks for a month that fits in 35 cells", () => {
    // Feb 2026 opens on a Sunday: 6 lead days + 28 days in month = 34, which
    // rounds up to 35 (five weeks) rather than needing a sixth row.
    const grid = monthGrid(new Date(2026, 1, 1));

    expect(grid.days).toHaveLength(35);
    expect(grid.start).toEqual(new Date(2026, 0, 26));
    expect(grid.end).toEqual(new Date(2026, 2, 2));
    expect(grid.days[0]).toEqual(grid.start);
    expect(grid.days[0].getDay()).toBe(1); // Monday
  });

  it("adds a sixth row when the month straddles it", () => {
    // March 2026 opens on a Sunday with 31 days: 6 + 31 = 37, needing 42 cells.
    const grid = monthGrid(new Date(2026, 2, 1));

    expect(grid.days).toHaveLength(42);
  });

  it("produces consecutive calendar days with no gaps", () => {
    const grid = monthGrid(new Date(2026, 4, 1));

    for (let i = 1; i < grid.days.length; i++) {
      const diffDays = (grid.days[i].getTime() - grid.days[i - 1].getTime()) / 86_400_000;
      expect(diffDays).toBeCloseTo(1, 5);
    }
  });
});

describe("shiftMonth", () => {
  it("moves forward within the same year", () => {
    expect(shiftMonth(new Date(2026, 2, 15), 1)).toEqual(new Date(2026, 3, 1));
  });

  it("rolls over into the next year", () => {
    expect(shiftMonth(new Date(2026, 11, 1), 1)).toEqual(new Date(2027, 0, 1));
  });

  it("rolls back into the previous year", () => {
    expect(shiftMonth(new Date(2026, 0, 1), -1)).toEqual(new Date(2025, 11, 1));
  });
});

describe("WEEKDAYS", () => {
  it("lists all seven days, Monday first", () => {
    expect(WEEKDAYS).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});
