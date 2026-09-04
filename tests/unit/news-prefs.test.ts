import { describe, expect, it } from "vitest";
import { mergeViewedCats, parseDateParam, parseViewedCats, VIEWED_CATS_MAX } from "@/lib/news-prefs";

describe("parseViewedCats", () => {
  it("returns [] for missing or empty values", () => {
    expect(parseViewedCats(undefined)).toEqual([]);
    expect(parseViewedCats(null)).toEqual([]);
    expect(parseViewedCats("")).toEqual([]);
  });

  it("splits, trims and keeps order", () => {
    expect(parseViewedCats("laser-cutting, welding ,fabrication")).toEqual(["laser-cutting", "welding", "fabrication"]);
  });

  it("drops junk that is not a slug", () => {
    expect(parseViewedCats("welding,<script>,DROP TABLE,,%%%,laser")).toEqual(["welding", "laser"]);
  });

  it("dedupes keeping the first (most recent) occurrence", () => {
    expect(parseViewedCats("a,b,a,c,b")).toEqual(["a", "b", "c"]);
  });

  it("caps at VIEWED_CATS_MAX", () => {
    expect(parseViewedCats("a,b,c,d,e,f,g")).toHaveLength(VIEWED_CATS_MAX);
  });

  it("URI-decodes and lowercases, and survives malformed encoding", () => {
    expect(parseViewedCats("Welding%2Claser")).toEqual(["welding", "laser"]);
    expect(parseViewedCats("%E0%A4%A")).toEqual([]); // bad escape — no throw
  });
});

describe("mergeViewedCats", () => {
  it("puts new slugs first and dedupes against the existing list", () => {
    expect(mergeViewedCats("welding,laser", ["fabrication", "welding"])).toBe("fabrication,welding,laser");
  });

  it("caps the merged list at VIEWED_CATS_MAX, evicting the oldest", () => {
    expect(mergeViewedCats("a,b,c,d,e", ["z"])).toBe("z,a,b,c,d");
  });

  it("ignores invalid new slugs but keeps the valid remainder", () => {
    expect(mergeViewedCats("laser", ["<x>", "welding"])).toBe("welding,laser");
  });

  it("works with no existing cookie", () => {
    expect(mergeViewedCats(undefined, ["welding"])).toBe("welding");
    expect(mergeViewedCats(undefined, [])).toBe("");
  });
});

describe("parseDateParam", () => {
  it("accepts a real YYYY-MM-DD date", () => {
    expect(parseDateParam("2026-09-03")).toBe("2026-09-03");
    expect(parseDateParam("2024-02-29")).toBe("2024-02-29"); // leap day
  });

  it("rejects malformed shapes", () => {
    expect(parseDateParam(undefined)).toBeUndefined();
    expect(parseDateParam(["2026-09-03"])).toBeUndefined();
    expect(parseDateParam("03/09/2026")).toBeUndefined();
    expect(parseDateParam("2026-9-3")).toBeUndefined();
    expect(parseDateParam("not-a-date")).toBeUndefined();
    expect(parseDateParam("2026-09-03T00:00:00Z")).toBeUndefined();
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDateParam("2026-13-01")).toBeUndefined();
    expect(parseDateParam("2026-02-30")).toBeUndefined();
    expect(parseDateParam("2025-02-29")).toBeUndefined(); // not a leap year
  });
});
