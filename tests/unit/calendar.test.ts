import { describe, expect, it } from "vitest";
import { dayKey, monthGrid, monthKey, parseMonth, shiftMonth, ukTime, WEEKDAYS } from "@/lib/calendar";

// GAPS A3.9: UK days whatever the machine's zone. Every instant here is a
// fixed UTC one, so these pass the same on a laptop in BST and on Vercel (UTC).
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));

describe("dayKey", () => {
  it("formats a calendar day as YYYY-MM-DD, zero-padded", () => {
    expect(dayKey(day(2026, 1, 5))).toBe("2026-01-05");
    expect(dayKey(day(2026, 12, 25))).toBe("2026-12-25");
  });

  it("puts an item at 00:30 UK summer time on its UK day, not the UTC day before", () => {
    // 00:30 BST on 1 Jul is 23:30 UTC on 30 Jun.
    expect(dayKey(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });

  it("keeps 23:30 GMT in winter on its own day", () => {
    expect(dayKey(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
  });
});

describe("monthKey", () => {
  it("formats as YYYY-MM, zero-padded, in UK time", () => {
    expect(monthKey(day(2026, 1, 5))).toBe("2026-01");
    expect(monthKey(day(2026, 12, 25))).toBe("2026-12");
    expect(monthKey(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07");
  });
});

describe("parseMonth", () => {
  it("parses a well-formed YYYY-MM into the first of that month", () => {
    expect(parseMonth("2026-03")).toEqual(day(2026, 3, 1));
  });

  it("falls back to the current UK month for an undefined or malformed value", () => {
    // 00:30 BST on 1 Aug is still 31 Jul in UTC: the UK month is August.
    const now = new Date("2026-07-31T23:30:00Z");
    expect(parseMonth(undefined, now)).toEqual(day(2026, 8, 1));
    expect(parseMonth("not-a-month", now)).toEqual(day(2026, 8, 1));
    expect(parseMonth("2026/03", now)).toEqual(day(2026, 8, 1));
  });

  it("falls back to the current month when the month number is out of range", () => {
    const now = new Date("2026-02-10T09:00:00Z");
    expect(parseMonth("2026-00", now)).toEqual(day(2026, 2, 1));
    expect(parseMonth("2026-13", now)).toEqual(day(2026, 2, 1));
  });
});

describe("monthGrid", () => {
  it("builds five whole Mon-first weeks for a month that fits in 35 cells", () => {
    // Feb 2026 opens on a Sunday: 6 lead days + 28 days in month = 34, which
    // rounds up to 35 (five weeks) rather than needing a sixth row.
    const grid = monthGrid(day(2026, 2, 1));

    expect(grid.days).toHaveLength(35);
    expect(dayKey(grid.days[0])).toBe("2026-01-26");
    expect(grid.days[0].getUTCDay()).toBe(1); // Monday
    expect(dayKey(grid.days[34])).toBe("2026-03-01");
  });

  it("bounds the query at UK midnights: GMT in winter, an hour earlier in UTC in summer", () => {
    // Winter: 26 Jan to 2 Mar, both GMT.
    const winter = monthGrid(day(2026, 2, 1));
    expect(winter.start.toISOString()).toBe("2026-01-26T00:00:00.000Z");
    expect(winter.end.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(dayKey(winter.start)).toBe("2026-01-26");
    expect(dayKey(winter.end)).toBe("2026-03-02");

    // July 2026 opens on a Wednesday: the grid runs 29 Jun to 2 Aug, all BST.
    const summer = monthGrid(day(2026, 7, 1));
    expect(summer.start.toISOString()).toBe("2026-06-28T23:00:00.000Z");
    expect(summer.end.toISOString()).toBe("2026-08-02T23:00:00.000Z");
    expect(dayKey(summer.start)).toBe("2026-06-29");
    expect(dayKey(summer.end)).toBe("2026-08-03");
  });

  it("an item at 00:30 BST on the 1st lands inside the grid's bounds and on the 1st's cell", () => {
    const grid = monthGrid(day(2026, 7, 1));
    const at = new Date("2026-06-30T23:30:00Z");
    expect(at >= grid.start && at < grid.end).toBe(true);
    expect(grid.days.map(dayKey)).toContain(dayKey(at));
    expect(dayKey(at)).toBe("2026-07-01");
  });

  it("adds a sixth row when the month straddles it", () => {
    // March 2026 opens on a Sunday with 31 days: 6 + 31 = 37, needing 42 cells.
    expect(monthGrid(day(2026, 3, 1)).days).toHaveLength(42);
  });

  it("produces consecutive calendar days with no gaps, across a clock change", () => {
    const grid = monthGrid(day(2026, 3, 1)); // clocks go forward 29 Mar
    for (let i = 1; i < grid.days.length; i++) {
      expect(grid.days[i].getTime() - grid.days[i - 1].getTime()).toBe(86_400_000);
    }
  });
});

describe("shiftMonth", () => {
  it("moves forward within the same year", () => {
    expect(shiftMonth(day(2026, 3, 15), 1)).toEqual(day(2026, 4, 1));
  });

  it("rolls over into the next year", () => {
    expect(shiftMonth(day(2026, 12, 1), 1)).toEqual(day(2027, 1, 1));
  });

  it("rolls back into the previous year", () => {
    expect(shiftMonth(day(2026, 1, 1), -1)).toEqual(day(2025, 12, 1));
  });
});

describe("ukTime", () => {
  it("shows the UK time of day, BST in summer", () => {
    expect(ukTime(new Date("2026-07-01T09:00:00Z"))).toBe("10:00");
    expect(ukTime(new Date("2026-12-01T09:00:00Z"))).toBe("09:00");
  });
});

describe("WEEKDAYS", () => {
  it("lists all seven days, Monday first", () => {
    expect(WEEKDAYS).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});
