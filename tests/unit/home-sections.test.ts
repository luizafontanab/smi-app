import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_SECTIONS, HOME_SECTION_IDS, moveHomeSection, resolveHomeSections, visibleHomeSections } from "@/lib/home-sections";

describe("home sections (GAPS A1.7)", () => {
  it("falls back to the default layout for nothing, junk or a non-object", () => {
    expect(resolveHomeSections(null)).toEqual(DEFAULT_HOME_SECTIONS);
    expect(resolveHomeSections("x")).toEqual(DEFAULT_HOME_SECTIONS);
    expect(resolveHomeSections({ order: 5, hidden: "all" })).toEqual(DEFAULT_HOME_SECTIONS);
  });

  it("keeps a stored order, drops unknown ids and duplicates, and appends anything missing", () => {
    const r = resolveHomeSections({ order: ["events", "bogus", "events", "videos"], hidden: [] });
    expect(r.order).toEqual(["events", "videos", "member_news", "supplier_logos", "newsletters"]);
    expect([...r.order].sort()).toEqual([...HOME_SECTION_IDS].sort());
  });

  // Paid placements live in these two; hiding either would switch off something a member paid for.
  it("never hides a section carrying a paid placement", () => {
    const r = resolveHomeSections({ order: [], hidden: ["videos", "supplier_logos", "events", "events"] });
    expect(r.hidden).toEqual(["events"]);
  });

  it("lists the visible sections in order", () => {
    expect(visibleHomeSections({ order: ["newsletters", "videos", "events", "member_news", "supplier_logos"], hidden: ["events"] }))
      .toEqual(["newsletters", "videos", "member_news", "supplier_logos"]);
  });

  it("moves a section one place, ignoring moves off either end", () => {
    const order = [...HOME_SECTION_IDS];
    expect(moveHomeSection(order, "member_news", "up")).toEqual(["member_news", "videos", "supplier_logos", "events", "newsletters"]);
    expect(moveHomeSection(order, "videos", "up")).toEqual(order);
    expect(moveHomeSection(order, "newsletters", "down")).toEqual(order);
  });
});
