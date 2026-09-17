/**
 * Derives a member's single Industry from their real WordPress Services tags.
 *
 * ⚠ THIS IS A DEV-ONLY ASSUMPTION, NOT REAL DATA. ⚠
 *
 * The live site shows a 10-item Industries list (docs/ask-jas.md) with one per
 * member, but that list exists nowhere in the WordPress export — verified
 * against the original database dump, whose only member taxonomies are
 * `best-service` (69 Services terms) and `best-level` (4 legacy Sector terms).
 * So every assignment below is inferred from a member's Services tags rather
 * than stated by the source, and roughly 8% of members resolve to no industry
 * at all. Jas has to validate the real assignments before launch — this is the
 * top item in docs/GO-LIVE.md.
 *
 * Rule: highest-priority matching service wins. Ties go to the industry with
 * the fewest mapped terms here — the narrower bucket is the more specific claim
 * (Welding has 2 terms, Fabrication 21) — and any remaining tie falls back to
 * INDUSTRIES order, which is arbitrary and flagged as such.
 *
 * Two other rules were tried against the real 123 members and rejected:
 * "first match wins" is order-dependent (WordPress stores a member's services
 * arbitrarily) and starved Tube Bending to zero; adding a per-extra-tag breadth
 * bonus starved *Welding* to zero, because it silently rewards industries by
 * how many service terms happen to be mapped to them rather than by what the
 * member does.
 *
 * Priority: 5 = names the industry almost exactly · 4 = strongly specific to it
 * · 3 = clearly belongs but is as often a supporting capability · 2 =
 * weak/generic. Terms that are not an industry at all (finance, PR,
 * recruitment, logistics, trade bodies) are deliberately absent, so those
 * members get no industry rather than a forced one.
 */
import { INDUSTRIES, type Industry } from "./industries";

type Rule = { industry: Industry; priority: number };

export const SERVICE_TO_INDUSTRY: Record<string, Rule> = {
  // — Laser Cutting
  "cutting-systems-laser-plasma-waterjet-oxyfuel": { industry: "Laser Cutting", priority: 5 },
  "laser-profiling-plasma-waterjet-oxyfuel-cutting": { industry: "Laser Cutting", priority: 5 },
  "laser-part-marking-equipment": { industry: "Laser Cutting", priority: 3 },

  // — Welding
  "welding-joining-fastening": { industry: "Welding", priority: 5 },
  "fastening-joining": { industry: "Welding", priority: 4 },

  // — Automation & Robotics
  "automation-robotics": { industry: "Automation & Robotics", priority: 5 },

  // — Tube Bending. Only 6 of the 19 tube-bending members are also tagged
  // welding, so these sit at 5 with everything else and let the specificity
  // tiebreak decide; forcing them higher emptied Welding entirely.
  "tube-bending-and-pipe-fabrication": { industry: "Tube Bending", priority: 5 },
  "tube-bending-manipulation-services": { industry: "Tube Bending", priority: 5 },

  // — Press Brakes
  "press-brakes-guillotines-nibbling-notching-ironworkers": { industry: "Press Brakes", priority: 5 },
  "press-brake-guillotine-nibbling-notching-services": { industry: "Press Brakes", priority: 5 },
  "bending-folding-levelling-manipulation-machines": { industry: "Press Brakes", priority: 3 },
  "bending-folding-levelling-services": { industry: "Press Brakes", priority: 3 },

  // — Finishing & Coating
  "finishing-polishing-powder-coating-painting": { industry: "Finishing & Coating", priority: 5 },
  "surface-finishing-deburring-grinding-heat-treatment": { industry: "Finishing & Coating", priority: 4 },
  "grinding-lapping-polishing": { industry: "Finishing & Coating", priority: 3 },

  // — Software. Deliberately low: a press manufacturer that also ships CAD/ERP
  // is not a software company (Bruderer UK came out as Software at priority 5).
  // A member whose only mapped tag is software still lands here, since nothing
  // outranks it.
  "software-cad-cam-erp": { industry: "Software", priority: 3 },
  "it-services": { industry: "Software", priority: 3 },

  // — Service & Maintenance
  "equipment-servicing-maintenance-repair-installation": { industry: "Service & Maintenance", priority: 5 },
  "equipment-hire-specialists": { industry: "Service & Maintenance", priority: 3 },
  "inspection-test-measurement": { industry: "Service & Maintenance", priority: 3 },
  "quality-control-inspection-testing-measurement": { industry: "Service & Maintenance", priority: 3 },
  "consultancy-services": { industry: "Service & Maintenance", priority: 2 },
  "training-education-providers": { industry: "Service & Maintenance", priority: 2 },
  "apprenticeships-education": { industry: "Service & Maintenance", priority: 2 },

  // — Machinery Sales (equipment and supply, rather than a process)
  "material-handling-equipment": { industry: "Machinery Sales", priority: 3 },
  "material-sheet-handling-storage-systems": { industry: "Machinery Sales", priority: 3 },
  "factory-equipment": { industry: "Machinery Sales", priority: 3 },
  "materials-suppliers-metals-composites-exotics": { industry: "Machinery Sales", priority: 3 },
  "cleaning-equipment": { industry: "Machinery Sales", priority: 3 },
  "casting-equipment": { industry: "Machinery Sales", priority: 3 },
  "extrusion-machines": { industry: "Machinery Sales", priority: 3 },
  "sawing-technology": { industry: "Machinery Sales", priority: 3 },
  "sawing-cutting-off": { industry: "Machinery Sales", priority: 3 },
  "consumables": { industry: "Machinery Sales", priority: 2 },
  "coolants-oils-lubricants-chemicals": { industry: "Machinery Sales", priority: 2 },
  "tool-storage-vending": { industry: "Machinery Sales", priority: 2 },
  "workholding": { industry: "Machinery Sales", priority: 2 },
  "personal-protective-equipment": { industry: "Machinery Sales", priority: 2 },

  // — Fabrication (the forming/pressing/tooling processes)
  "punching-hole-making": { industry: "Fabrication", priority: 4 },
  "power-presses-stamping-low-high-speed": { industry: "Fabrication", priority: 4 },
  "presses-stamping": { industry: "Fabrication", priority: 4 },
  "press-works-stamping-services": { industry: "Fabrication", priority: 4 },
  "press-tools-punches": { industry: "Fabrication", priority: 3 },
  "tooling-press-tools-punches-and-dies": { industry: "Fabrication", priority: 3 },
  "tool-and-die": { industry: "Fabrication", priority: 3 },
  "tool-die": { industry: "Fabrication", priority: 3 },
  "roll-forming-plate-rolling": { industry: "Fabrication", priority: 3 },
  "cold-forming-machines": { industry: "Fabrication", priority: 3 },
  "cold-forming-services": { industry: "Fabrication", priority: 3 },
  "forging": { industry: "Fabrication", priority: 3 },
  "edm-electro-discharge-machining": { industry: "Fabrication", priority: 3 },
  "coil-processing-cut-to-length-lines-slitting-blanking-lines": { industry: "Fabrication", priority: 3 },
  "coil-processing-cutting-slitting-services": { industry: "Fabrication", priority: 3 },
  "additive-manufacturing-3d-printing": { industry: "Fabrication", priority: 3 },
  "additive-manufacturing-3d-printing-services": { industry: "Fabrication", priority: 3 },
  "forming": { industry: "Fabrication", priority: 2 },
  "assembly": { industry: "Fabrication", priority: 2 },
  "design-prototyping-services": { industry: "Fabrication", priority: 2 },
  "product-design-research-and-development": { industry: "Fabrication", priority: 2 },

  // Deliberately unmapped (not an industry): auctioneer-valuers,
  // financial-services-leasing-asset-financing-funding, pr-marketing-service-providers,
  // recruitment-services, trade-association-events, transportation-services,
  // utility-services, waste-management, packaging-suppliers,
  // part-marking-product-identification.
};

/** How many service terms map to each industry — the tiebreak weight: a narrower
 * bucket is the more specific claim. Computed once from the table above. */
const TERMS_PER_INDUSTRY = Object.values(SERVICE_TO_INDUSTRY).reduce<Map<Industry, number>>(
  (acc, r) => acc.set(r.industry, (acc.get(r.industry) ?? 0) + 1),
  new Map(),
);

/** The member's industry, or null when none of their services map to one. */
export function industryForServices(serviceSlugs: string[]): Industry | null {
  const best = new Map<Industry, number>();
  for (const slug of serviceSlugs) {
    const rule = SERVICE_TO_INDUSTRY[slug];
    if (rule) best.set(rule.industry, Math.max(best.get(rule.industry) ?? 0, rule.priority));
  }
  let winner: Industry | null = null;
  for (const industry of INDUSTRIES) {
    if (!best.has(industry)) continue;
    if (winner === null) { winner = industry; continue; }
    const [a, b] = [best.get(industry)!, best.get(winner)!];
    // higher priority wins; on a tie the narrower (fewer-term) industry wins;
    // INDUSTRIES order settles the rest, arbitrarily but deterministically.
    if (a > b || (a === b && TERMS_PER_INDUSTRY.get(industry)! < TERMS_PER_INDUSTRY.get(winner)!)) winner = industry;
  }
  return winner;
}
