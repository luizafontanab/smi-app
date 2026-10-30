import { describe, expect, it } from "vitest";
import { londonToday, paginate, parseRange, pctChange, previousRange, sessionsPerUser, sqlBounds, toSiteStats } from "@/lib/analytics-report";

const TODAY = "2026-10-29";

describe("parseRange", () => {
  it("defaults to the last 28 days, today included", () => {
    expect(parseRange({}, TODAY)).toEqual({ from: "2026-10-02", to: TODAY, days: 28 });
  });

  it("takes a preset", () => {
    expect(parseRange({ days: "7" }, TODAY)).toEqual({ from: "2026-10-23", to: TODAY, days: 7 });
    expect(parseRange({ days: "90" }, TODAY).days).toBe(90);
  });

  it("ignores a preset that isn't one of the offered ones", () => {
    expect(parseRange({ days: "5000" }, TODAY).days).toBe(28);
  });

  it("takes an explicit range, inclusive of both ends", () => {
    expect(parseRange({ from: "2026-10-26", to: "2026-10-28" }, TODAY)).toEqual({ from: "2026-10-26", to: "2026-10-28", days: 3 });
  });

  it("swaps reversed dates", () => {
    expect(parseRange({ from: "2026-10-28", to: "2026-10-26" }, TODAY)).toEqual({ from: "2026-10-26", to: "2026-10-28", days: 3 });
  });

  it("pulls future dates back to today", () => {
    expect(parseRange({ from: "2026-10-20", to: "2027-01-01" }, TODAY)).toEqual({ from: "2026-10-20", to: TODAY, days: 10 });
    expect(parseRange({ from: "2027-01-01", to: "2027-02-01" }, TODAY)).toEqual({ from: TODAY, to: TODAY, days: 1 });
  });

  it("caps the span at a year", () => {
    expect(parseRange({ from: "2020-01-01", to: TODAY }, TODAY).days).toBe(366);
  });

  it("falls back to the default on malformed or impossible dates", () => {
    expect(parseRange({ from: "yesterday", to: TODAY }, TODAY).days).toBe(28);
    expect(parseRange({ from: "2026-02-30", to: TODAY }, TODAY).days).toBe(28);
    expect(parseRange({ from: ["2026-10-01"], to: TODAY }, TODAY).days).toBe(28);
  });
});

describe("previousRange", () => {
  it("is the same length, ending the day before", () => {
    expect(previousRange({ from: "2026-10-26", to: "2026-10-28", days: 3 })).toEqual({ from: "2026-10-23", to: "2026-10-25", days: 3 });
  });

  it("crosses a month end", () => {
    expect(previousRange({ from: "2026-10-01", to: "2026-10-07", days: 7 })).toEqual({ from: "2026-09-24", to: "2026-09-30", days: 7 });
  });
});

describe("sqlBounds", () => {
  it("is [from midnight, the day after to) in London, so the last day is whole", () => {
    expect(sqlBounds({ from: "2026-10-26", to: "2026-10-28", days: 3 })).toEqual({
      p_from: "2026-10-26 00:00:00 Europe/London",
      p_to: "2026-10-29 00:00:00 Europe/London",
    });
  });
});

describe("londonToday", () => {
  it("uses the London calendar day, not UTC", () => {
    // 23:30 UTC on 31 Aug is 00:30 BST on 1 Sep.
    expect(londonToday(new Date("2026-08-31T23:30:00Z"))).toBe("2026-09-01");
    expect(londonToday(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
  });
});

describe("pctChange", () => {
  it("matches the report's arithmetic", () => {
    expect(pctChange(421, 358)).toBeCloseTo(17.6, 1);
    expect(pctChange(12, 21)).toBeCloseTo(-42.9, 1);
    expect(pctChange(5, 5)).toBe(0);
  });

  it("is null without a baseline, rather than Infinity", () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(0, 0)).toBeNull();
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 162 }, (_, i) => i);

  it("reads 1–10 / 162 on the first page", () => {
    const p = paginate(items, undefined);
    expect([p.start, p.end, p.total, p.pages]).toEqual([1, 10, 162, 17]);
    expect(p.rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("shows a short last page", () => {
    const p = paginate(items, "17");
    expect([p.start, p.end]).toEqual([161, 162]);
  });

  it("clamps an out-of-range or junk page", () => {
    expect(paginate(items, "99").page).toBe(17);
    expect(paginate(items, "-3").page).toBe(1);
    expect(paginate(items, "abc").page).toBe(1);
  });

  it("handles nothing at all", () => {
    expect(paginate([], 1)).toEqual({ rows: [], page: 1, pages: 1, start: 0, end: 0, total: 0 });
  });
});

describe("toSiteStats", () => {
  it("reads zeros and empties from a null or partial RPC result", () => {
    expect(toSiteStats(null).views).toBe(0);
    const s = toSiteStats({ views: "12", users: 4, top_pages: "nope" });
    expect(s.views).toBe(12);
    expect(s.users).toBe(4);
    expect(s.top_pages).toEqual([]);
  });

  it("works out sessions per user without dividing by zero", () => {
    expect(sessionsPerUser(toSiteStats({ users: 157, sessions: 220 }))).toBeCloseTo(1.4, 1);
    expect(sessionsPerUser(toSiteStats({ users: 0, sessions: 0 }))).toBe(0);
  });
});
