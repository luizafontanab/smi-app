import { describe, expect, it } from "vitest";
import { SERVICE_TO_INDUSTRY, industryForServices } from "../../scripts/lib/industry-map";
import { INDUSTRIES, industrySlug } from "../../scripts/lib/industries";

/**
 * industryForServices decides every member's industry on both seeds and on the
 * production backfill, and roughly 8% of members legitimately resolve to
 * nothing — so the rules that pick a winner, and the rule that refuses to pick
 * one, are both worth pinning. The industry list itself is a dev assumption
 * awaiting Jas (docs/GO-LIVE.md 1.1); these tests cover the algorithm, not
 * whether the assignments are *right*.
 */
describe("industryForServices", () => {
  it("returns null for no services at all", () => {
    expect(industryForServices([])).toBeNull();
  });

  it("returns null when nothing the member does maps to an industry", () => {
    // Deliberately unmapped in the table: these are not industries, and a
    // forced guess would be worse than no answer.
    expect(industryForServices(["recruitment-services", "financial-services-leasing-asset-financing-funding"])).toBeNull();
  });

  it("ignores unknown slugs rather than throwing", () => {
    expect(industryForServices(["not-a-real-service", "welding-joining-fastening"])).toBe("Welding");
  });

  it("takes the highest-priority match, not the first one listed", () => {
    // punching-hole-making is 4 (Fabrication), software-cad-cam-erp is 3
    // (Software, deliberately low so a press maker that ships CAD isn't a
    // software company). Order in the array must not matter.
    expect(industryForServices(["software-cad-cam-erp", "punching-hole-making"])).toBe("Fabrication");
    expect(industryForServices(["punching-hole-making", "software-cad-cam-erp"])).toBe("Fabrication");
  });

  it("breaks a priority tie toward the narrower industry", () => {
    // Both are priority 5. Welding has 2 mapped terms, Laser Cutting 3 — the
    // narrower bucket is the more specific claim, so Welding wins.
    const a = "welding-joining-fastening";
    const b = "cutting-systems-laser-plasma-waterjet-oxyfuel";
    expect(SERVICE_TO_INDUSTRY[a].priority).toBe(SERVICE_TO_INDUSTRY[b].priority);
    expect(industryForServices([a, b])).toBe("Welding");
    expect(industryForServices([b, a])).toBe("Welding");
  });

  it("lets a low-priority match win when nothing outranks it", () => {
    // consultancy-services is priority 2 — weak, but it is the only signal.
    expect(industryForServices(["consultancy-services"])).toBe("Service & Maintenance");
  });

  it("only ever returns a name from the canonical list", () => {
    for (const rule of Object.values(SERVICE_TO_INDUSTRY)) {
      expect(INDUSTRIES).toContain(rule.industry);
    }
  });

  it("maps every industry it returns to a slug the industries table has", () => {
    // The migration inserts these slugs verbatim; a drift here would leave
    // members pointing at nothing after a seed.
    const slugs = INDUSTRIES.map(industrySlug);
    expect(new Set(slugs).size).toBe(INDUSTRIES.length);
    expect(slugs).toContain("automation-robotics");
    expect(slugs).toContain("finishing-coating");
    expect(slugs).toContain("service-maintenance");
  });
});
