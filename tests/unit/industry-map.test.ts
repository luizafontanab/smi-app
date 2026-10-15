import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATCH_ALLS,
  CATEGORY_TO_INDUSTRY,
  SERVICE_TO_INDUSTRY,
  industriesForServices,
  industryForCategories,
  primaryIndustry,
  unknownSlugs,
} from "../../scripts/lib/industry-map";
import { INDUSTRIES, INDUSTRY_ROWS, industrySlug } from "../../scripts/lib/industries";

/**
 * Jas's mapping decides every member's industries and primary, and every
 * story's industry, on both seeds and on the production backfill. The maps are
 * transcriptions of his sheet; these tests pin the rule that turns several
 * matches into one, and that the transcription stays complete and in step
 * with the migration's list.
 */

describe("the industry list", () => {
  it("is Jas's ten, in his order", () => {
    expect(INDUSTRIES).toEqual([
      "Automation & Robotics",
      "Inspection & Measurement",
      "Grinding & Surface Finishing",
      "Processing Technology",
      "Machinery, Tools & Equipment",
      "Software & IT Services",
      "Bending & Forming",
      "Welding & Joining",
      "Subcontractor News",
      "Events, Open Houses & Education",
    ]);
  });

  it("matches the rows migration 20261012000001 inserts, slug for slug and in order", () => {
    // industries.ts and the migration must be changed together; a drift leaves
    // the backfill unable to find an industry the code believes in.
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    const file = readdirSync(dir).find((f) => f.startsWith("20261012000001_"))!;
    const sql = readFileSync(path.join(dir, file), "utf8");
    const rows = [...sql.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)',\s*(\d+)\)/g)].map(([, slug, name, order]) => ({
      slug,
      name,
      sort_order: Number(order),
    }));
    expect(rows).toEqual(INDUSTRY_ROWS);
  });

  it("gives every industry a distinct slug", () => {
    expect(new Set(INDUSTRIES.map(industrySlug)).size).toBe(INDUSTRIES.length);
  });
});

describe("the transcribed maps", () => {
  it("cover all 36 news categories and 69 services in the vocabularies", () => {
    // 36 = the 44 WP tags minus the 8 junk ones (news-topics.ts); 69 = the WP
    // best-service terms — 68 from Jas's sheet plus tool-and-die, which he left
    // off and is assumed to follow its twin tool-die.
    expect(Object.keys(CATEGORY_TO_INDUSTRY)).toHaveLength(36);
    expect(Object.keys(SERVICE_TO_INDUSTRY)).toHaveLength(69);
    expect(SERVICE_TO_INDUSTRY["tool-and-die"]).toBe(SERVICE_TO_INDUSTRY["tool-die"]);
  });

  it("only ever name an industry from the canonical list", () => {
    for (const industry of [...Object.values(SERVICE_TO_INDUSTRY), ...Object.values(CATEGORY_TO_INDUSTRY)]) {
      if (industry !== null) expect(INDUSTRIES).toContain(industry);
    }
  });

  it("leave the terms Jas gave no industry as an explicit null", () => {
    expect(SERVICE_TO_INDUSTRY["recruitment-services"]).toBeNull();
    expect(CATEGORY_TO_INDUSTRY["industry-news"]).toBeNull();
  });
});

describe("primaryIndustry", () => {
  it("returns null for no terms, and for terms that map nowhere", () => {
    expect(primaryIndustry([])).toBeNull();
    expect(primaryIndustry(["recruitment-services", "waste-management"])).toBeNull();
  });

  it("ignores slugs the map has never seen rather than throwing", () => {
    expect(primaryIndustry(["not-a-real-service", "welding-joining-fastening"])).toBe("Welding & Joining");
  });

  it("puts a specific industry ahead of the catch-alls, however many catch-all terms there are", () => {
    // Three Machinery terms and one Welding term: Welding is what they *do*.
    const slugs = ["sawing-technology", "forging", "consumables", "welding-joining-fastening"];
    expect(CATCH_ALLS.has("Machinery, Tools & Equipment")).toBe(true);
    expect(primaryIndustry(slugs)).toBe("Welding & Joining");
  });

  it("falls back to a catch-all when nothing specific applies", () => {
    expect(primaryIndustry(["sawing-technology", "forging"])).toBe("Machinery, Tools & Equipment");
    expect(primaryIndustry(["assembly"])).toBe("Subcontractor News");
  });

  it("between catch-alls, the one more terms point at wins", () => {
    expect(primaryIndustry(["assembly", "tool-die", "forging"])).toBe("Subcontractor News");
  });

  it("among specific industries, the one more terms point at wins", () => {
    // two Bending & Forming terms beat one Welding term
    expect(primaryIndustry(["forming", "roll-forming-plate-rolling", "welding-joining-fastening"])).toBe("Bending & Forming");
  });

  it("breaks a tie toward the narrower industry, whatever the input order", () => {
    // One term each. Welding & Joining has 1 service mapped to it, Bending &
    // Forming 4 — the narrower bucket is the more specific claim.
    const a = "welding-joining-fastening";
    const b = "tube-bending-and-pipe-fabrication";
    expect(primaryIndustry([a, b])).toBe("Welding & Joining");
    expect(primaryIndustry([b, a])).toBe("Welding & Joining");
  });

  it("settles an exact tie by list order", () => {
    // Automation & Robotics and Processing Technology: one service each in the map.
    expect(primaryIndustry(["coil-processing-cut-to-length-lines-slitting-blanking-lines", "automation-robotics"])).toBe(
      "Automation & Robotics",
    );
  });

  it("counts a repeated slug once", () => {
    const w = "welding-joining-fastening";
    expect(primaryIndustry([w, w, w, "forming", "roll-forming-plate-rolling"])).toBe("Bending & Forming");
  });
});

describe("industriesForServices", () => {
  it("returns every industry the services touch, catch-alls included, in list order and deduplicated", () => {
    expect(
      industriesForServices(["welding-joining-fastening", "assembly", "sawing-technology", "forging", "automation-robotics"]),
    ).toEqual(["Automation & Robotics", "Machinery, Tools & Equipment", "Welding & Joining", "Subcontractor News"]);
  });

  it("always contains the primary industry", () => {
    for (const slugs of [["forging", "assembly"], ["software-cad-cam-erp", "it-services", "consumables"], ["forming"]]) {
      expect(industriesForServices(slugs)).toContain(primaryIndustry(slugs));
    }
  });

  it("is empty when nothing maps", () => {
    expect(industriesForServices(["auctioneer-valuers"])).toEqual([]);
  });
});

describe("industryForCategories", () => {
  it("uses the categories map, not the services one", () => {
    // The two tabs disagree on roll forming: Processing Technology for news,
    // Bending & Forming for services. Each follows its own tab.
    expect(industryForCategories(["roll-forming"])).toBe("Processing Technology");
    expect(primaryIndustry(["roll-forming-plate-rolling"])).toBe("Bending & Forming");
  });

  it("returns null for a story tagged only Industry News", () => {
    expect(industryForCategories(["industry-news"])).toBeNull();
  });
});

describe("unknownSlugs", () => {
  it("lists only slugs the map has no entry for — not the reviewed nulls", () => {
    expect(unknownSlugs(["industry-news", "brand-new-topic", "brand-new-topic", "forging"], CATEGORY_TO_INDUSTRY)).toEqual([
      "brand-new-topic",
    ]);
  });
});
