import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JUNK_TAG_SLUGS, newsTopics } from "../../scripts/lib/news-topics";

/**
 * Both seeds pass WordPress post tags through newsTopics before upserting
 * `categories`, and a migration deletes the same slugs from databases that were
 * already seeded. The two lists are maintained by hand, so pin that they agree.
 */
describe("newsTopics", () => {
  it("drops the junk tags and keeps real ones in order", () => {
    const rows = [
      { slug: "industry-news", name: "Industry News" },
      { slug: "waer", name: "waer" },
      { slug: "extrusion-machines", name: "Extrusion Machines" },
      { slug: "saintanns-sheet-metal-company-accreditations", name: "SAINTANNS…" },
      { slug: "rolls", name: "rolls" },
    ];
    expect(newsTopics(rows).map((r) => r.slug)).toEqual(["industry-news", "extrusion-machines"]);
  });

  it("keeps real-but-unused topics — the list is explicit, not a usage threshold", () => {
    for (const slug of ["extrusion-machines", "cold-forming-machines", "pr-marketing", "exhibitions"]) {
      expect(JUNK_TAG_SLUGS.has(slug)).toBe(false);
    }
  });

  it("matches the slugs the prune migration deletes", () => {
    const sql = readFileSync(
      path.resolve(__dirname, "../../supabase/migrations/20261004000001_prune_junk_categories.sql"),
      "utf8",
    );
    const inList = sql.slice(sql.indexOf("delete from categories"));
    const deleted = [...inList.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect(new Set(deleted)).toEqual(JUNK_TAG_SLUGS);
  });
});
