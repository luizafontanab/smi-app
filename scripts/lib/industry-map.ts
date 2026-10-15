/**
 * Which Industries a member's Services, and a story's news categories, point
 * at — Jas's mapping, used to backfill industries onto data that predates them.
 *
 * Source: Jas's spreadsheet of 12 Oct 2026 — tab 3 ("Current Member Services →
 * Industry") and tab 2 ("Current Story Category → Industry"), keyed here by the
 * terms' slugs. His spellings of the industry names varied between tabs
 * ("Bending & Forming" / "Bending/ Forming", "Software" / "Software/ IT
 * Services", "Metal Finishing"); each is resolved to tab 1's list, as tidied in
 * industries.ts. Where he left the industry blank the value is `null` —
 * reviewed, belongs to no industry — which is different from a slug missing
 * from the map: that one nobody has looked at, and the backfill reports it.
 *
 * This is a one-off backfill, not a live rule: "going forward you'll be able to
 * pick them separately" (Jas). Nothing at request time reads these maps.
 *
 * The two maps disagree on a few terms that appear in both vocabularies —
 * Financial Services, the material-handling pair, roll forming. Each map
 * follows its own tab as written; the conflicts are in docs/ask-jas.md.
 */
import { INDUSTRIES, type Industry } from "./industries";

type IndustryMap = Readonly<Record<string, Industry | null>>;

const AR: Industry = "Automation & Robotics";
const IM: Industry = "Inspection & Measurement";
const GSF: Industry = "Grinding & Surface Finishing";
const PT: Industry = "Processing Technology";
const MTE: Industry = "Machinery, Tools & Equipment";
const SW: Industry = "Software & IT Services";
const BF: Industry = "Bending & Forming";
const WJ: Industry = "Welding & Joining";
const SUB: Industry = "Subcontractor News";
const EV: Industry = "Events, Open Houses & Education";

/** Member Services (the WP `best-service` taxonomy) → industry. Tab 3. */
export const SERVICE_TO_INDUSTRY: IndustryMap = {
  "additive-manufacturing-3d-printing": MTE,
  "additive-manufacturing-3d-printing-services": SUB,
  "apprenticeships-education": EV,
  "assembly": SUB,
  "auctioneer-valuers": null,
  "automation-robotics": AR,
  "bending-folding-levelling-manipulation-machines": BF,
  "bending-folding-levelling-services": SUB,
  "casting-equipment": MTE,
  "cleaning-equipment": MTE,
  "coil-processing-cut-to-length-lines-slitting-blanking-lines": PT,
  "coil-processing-cutting-slitting-services": SUB,
  "cold-forming-machines": MTE,
  "cold-forming-services": SUB,
  "consultancy-services": SUB,
  "consumables": MTE,
  "coolants-oils-lubricants-chemicals": MTE,
  "cutting-systems-laser-plasma-waterjet-oxyfuel": MTE,
  "design-prototyping-services": SUB,
  "edm-electro-discharge-machining": MTE,
  "equipment-hire-specialists": MTE,
  "equipment-servicing-maintenance-repair-installation": null,
  "extrusion-machines": MTE,
  "factory-equipment": MTE,
  "fastening-joining": SUB,
  "financial-services-leasing-asset-financing-funding": null,
  "finishing-polishing-powder-coating-painting": SUB,
  "forging": MTE,
  "forming": BF,
  "grinding-lapping-polishing": GSF,
  "inspection-test-measurement": IM,
  "it-services": SW,
  "laser-part-marking-equipment": MTE,
  "laser-profiling-plasma-waterjet-oxyfuel-cutting": MTE,
  "material-handling-equipment": MTE,
  "material-sheet-handling-storage-systems": MTE,
  "materials-suppliers-metals-composites-exotics": null,
  "packaging-suppliers": MTE,
  "part-marking-product-identification": SUB,
  "personal-protective-equipment": MTE,
  "power-presses-stamping-low-high-speed": MTE,
  "pr-marketing-service-providers": null,
  "press-brake-guillotine-nibbling-notching-services": SUB,
  "press-brakes-guillotines-nibbling-notching-ironworkers": MTE,
  "press-tools-punches": MTE,
  "press-works-stamping-services": SUB,
  "presses-stamping": MTE,
  "product-design-research-and-development": SUB,
  "punching-hole-making": MTE,
  "quality-control-inspection-testing-measurement": IM,
  "recruitment-services": null,
  "roll-forming-plate-rolling": BF,
  "sawing-cutting-off": MTE,
  "sawing-technology": MTE,
  "software-cad-cam-erp": SW,
  // Jas wrote "Metal Finishing" here — not one of his ten; the closest is this.
  "surface-finishing-deburring-grinding-heat-treatment": GSF,
  "tool-die": SUB,
  // NOT in Jas's sheet (the only one of the 69 export terms missing). Assumed to
  // follow its near-duplicate "Tool & Die" above; asked in docs/ask-jas.md.
  "tool-and-die": SUB,
  "tool-storage-vending": MTE,
  "tooling-press-tools-punches-and-dies": MTE,
  "trade-association-events": EV,
  "training-education-providers": EV,
  "transportation-services": null,
  "tube-bending-and-pipe-fabrication": BF,
  "tube-bending-manipulation-services": SUB,
  "utility-services": null,
  "waste-management": null,
  "welding-joining-fastening": WJ,
  "workholding": MTE,
};

/** News categories (the `categories` table, from WP post tags) → industry. Tab 2. */
export const CATEGORY_TO_INDUSTRY: IndustryMap = {
  "additive-manufacturing": MTE,
  "associations-events": EV,
  "automation-robotics": AR,
  "bending-folding-levelling-manipulation-machines": BF,
  "castings": MTE,
  "coil-processing": PT,
  "cold-forming-machines": MTE,
  "coolants-oils-lubricants-chemicals": MTE,
  "cut-to-length-lines-slitting-blanking-lines": PT,
  "cutting-systems-laser-plasma-waterjet-oxyfuel": MTE,
  "edm-electro-discharge-machining": MTE,
  "education-apprenticeships": EV,
  "equipment-servicing-maintenance-repair-installation": null,
  "exhibitions": EV,
  "extrusion-machines": MTE,
  // As written; the Services tab leaves Financial Services without an
  // industry, so this looks like a slip. Asked in docs/ask-jas.md.
  "financial-services": EV,
  "forging": MTE,
  "industry-news": null,
  "inspection-testing-measurement": IM,
  "laser-part-marking-equipment": MTE,
  "material-handling-equipment": PT,
  "material-sheet-handling": PT,
  "powder-paint-coating": GSF,
  "pr-marketing": null,
  "press-brakes-guillotines-nibbling-notching": MTE,
  "presses-stamping": MTE,
  "punching-hole-making": MTE,
  "roll-forming": PT,
  "sawing-technology": MTE,
  "software-cad-cam-erp": SW,
  "surface-finishing-heat-treatment": GSF,
  "tool-storage-vending": MTE,
  "tooling-press-tools-punches-and-dies-2": MTE,
  "tube-bending-and-pipe-fabrication": BF,
  "welding-joining-fastening": WJ,
  "work-holding": MTE,
};

/**
 * The two broad buckets. Most members carry at least one machinery or
 * subcontracting service alongside what they actually specialise in — 90 of the
 * 123 real members touch Machinery — so a catch-all only becomes someone's
 * primary industry when nothing more specific applies.
 */
export const CATCH_ALLS: ReadonlySet<Industry> = new Set<Industry>([MTE, SUB]);

const order = (i: Industry) => INDUSTRIES.indexOf(i);

/** Terms mapped to each industry, per map — the tiebreak weight. */
const termsPer = new WeakMap<IndustryMap, Map<Industry, number>>();
const termsIn = (map: IndustryMap) => {
  let counts = termsPer.get(map);
  if (!counts) {
    counts = new Map();
    for (const industry of Object.values(map)) if (industry) counts.set(industry, (counts.get(industry) ?? 0) + 1);
    termsPer.set(map, counts);
  }
  return counts;
};

/** How many of the given terms map to each industry. Duplicates count once. */
const tally = (slugs: readonly string[], map: IndustryMap) => {
  const counts = new Map<Industry, number>();
  for (const slug of new Set(slugs)) {
    const industry = map[slug];
    if (industry) counts.set(industry, (counts.get(industry) ?? 0) + 1);
  }
  return counts;
};

/** Every industry a member's services point at, in INDUSTRIES order. */
export function industriesForServices(slugs: readonly string[]): Industry[] {
  const hit = tally(slugs, SERVICE_TO_INDUSTRY);
  return INDUSTRIES.filter((i) => hit.has(i));
}

/**
 * The single industry that best describes a set of terms, or null when none of
 * them maps to one. A specific industry beats a catch-all; then the industry
 * the most terms point at; then the narrower one (fewer terms mapped to it in
 * this map — the more specific claim); then INDUSTRIES order, which is
 * arbitrary but deterministic. Input order never matters.
 */
export function primaryIndustry(slugs: readonly string[], map: IndustryMap = SERVICE_TO_INDUSTRY): Industry | null {
  const hit = tally(slugs, map);
  if (!hit.size) return null;
  const all = [...hit.keys()];
  const specific = all.filter((i) => !CATCH_ALLS.has(i));
  const pool = specific.length ? specific : all;
  const terms = termsIn(map);
  pool.sort((a, b) => hit.get(b)! - hit.get(a)! || terms.get(a)! - terms.get(b)! || order(a) - order(b));
  return pool[0];
}

/** A story's industry from its news categories. */
export const industryForCategories = (slugs: readonly string[]) => primaryIndustry(slugs, CATEGORY_TO_INDUSTRY);

/** Slugs the map has never seen — vocabulary drift, reported rather than guessed at. */
export const unknownSlugs = (slugs: readonly string[], map: IndustryMap) =>
  [...new Set(slugs)].filter((s) => !(s in map));
