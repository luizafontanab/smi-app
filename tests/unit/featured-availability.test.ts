import { describe, expect, it } from "vitest";
import { featuredMonths, featuredWindow, monthLabel, monthLast } from "@/lib/featured-availability";
import { FEATURED_SLOTS } from "@/lib/pricing";

// Fixed instants, so these pass the same on a laptop in BST and on Vercel (UTC).
const NOW = new Date("2026-10-27T12:00:00Z");
const run = (starts_on: string, ends_on: string) => ({ starts_on, ends_on });
const nov = (runs: { starts_on: string; ends_on: string }[]) => featuredMonths(runs, NOW).find((m) => m.key === "2026-11")!;

describe("featuredMonths", () => {
  it("lists twelve months from the current UK month, with full bounds and labels", () => {
    const months = featuredMonths([], NOW);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ key: "2026-10", first: "2026-10-01", last: "2026-10-31", label: "October 2026", left: FEATURED_SLOTS.cap });
    expect(months[4]).toMatchObject({ key: "2027-02", first: "2027-02-01", last: "2027-02-28" });
    expect(months[11].key).toBe("2027-09");
  });

  it("starts from the UK month at 00:30 BST on the 1st, not the UTC month before", () => {
    // 23:30 UTC on 31 Aug is 00:30 BST on 1 Sep.
    expect(featuredMonths([], new Date("2026-08-31T23:30:00Z"))[0].key).toBe("2026-09");
  });

  it("counts every run touching the month — the console's overlap rule", () => {
    expect(nov([run("2026-10-01", "2026-11-01")]).left).toBe(FEATURED_SLOTS.cap - 1); // ends on the 1st
    expect(nov([run("2026-11-30", "2026-12-31")]).left).toBe(FEATURED_SLOTS.cap - 1); // starts on the last day
    expect(nov([run("2026-09-01", "2027-01-31")]).left).toBe(FEATURED_SLOTS.cap - 1); // spans it
    expect(nov([run("2026-10-01", "2026-10-31"), run("2026-12-01", "2026-12-31")]).left).toBe(FEATURED_SLOTS.cap); // either side
  });

  it("bottoms out at 0 when the cap is reached or passed", () => {
    const full = Array.from({ length: FEATURED_SLOTS.cap + 2 }, () => run("2026-11-01", "2026-11-30"));
    expect(nov(full).left).toBe(0);
  });
});

describe("month helpers", () => {
  it("labels and bounds a stored preferred_month", () => {
    expect(monthLabel("2026-11-01")).toBe("November 2026");
    expect(monthLast("2026-11-01")).toBe("2026-11-30");
    expect(monthLast("2028-02-01")).toBe("2028-02-29");
    expect(monthLast("2026-12-01")).toBe("2026-12-31");
  });

  it("featuredWindow spans the first month's 1st to the last month's end", () => {
    expect(featuredWindow(NOW)).toEqual({ from: "2026-10-01", to: "2027-09-30" });
  });
});
