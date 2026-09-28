/**
 * Which editorial sections the grid homepage shows below the fold, and in what
 * order — A13 ("configure the grid mix"), GAPS A1.7. Stored in `settings` under
 * HOME_SECTIONS_KEY, edited on /console/pages.
 *
 * Deliberately narrow, which is what kept this parked until 28 Sep: the
 * homepage is sold inventory as much as it is layout.
 *   · The fold (highlights, carousel, featured machine/event) is fixed.
 *   · The three banner slots are not sections and cannot move out of rhythm:
 *     home_1 always follows the fold, home_2 follows the FIRST section below it
 *     and home_3 the LAST, so a banner always sits between content and two can
 *     never touch while two or more sections show.
 *   · A section carrying a paid placement can be moved but never hidden —
 *     "videos" holds the Featured Members box, "supplier_logos" is the logo
 *     wall. Hiding either would switch off something a member paid for.
 * Per-section item counts are not configurable: the rows are three-column
 * grids, and arbitrary counts would leave ragged rows.
 *
 * Pure. Whatever is stored, resolveHomeSections returns a complete, valid
 * layout, so a malformed or out-of-date row can never blank the homepage.
 */

export const HOME_SECTIONS_KEY = "home_sections";

export const HOME_SECTION_IDS = ["videos", "member_news", "supplier_logos", "events", "newsletters"] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

export const HOME_SECTION_LABELS: Record<HomeSectionId, string> = {
  videos: "Latest videos, with the Featured Members box and newsletter/MACH panels",
  member_news: "Featured member news",
  supplier_logos: "Supplier logos",
  events: "Upcoming events",
  newsletters: "Latest newsletters",
};

/** Sections holding paid placements: movable, never hidden. */
export const LOCKED_VISIBLE: ReadonlySet<HomeSectionId> = new Set(["videos", "supplier_logos"]);

export type HomeSections = { order: HomeSectionId[]; hidden: HomeSectionId[] };

export const DEFAULT_HOME_SECTIONS: HomeSections = { order: [...HOME_SECTION_IDS], hidden: [] };

const isSectionId = (v: unknown): v is HomeSectionId => (HOME_SECTION_IDS as readonly unknown[]).includes(v);

/**
 * A stored value → a complete layout. Unknown ids are dropped, duplicates
 * collapse to their first position, and any section missing from the stored
 * order (one added in a later release, say) is appended in its default place,
 * so nothing ever silently disappears. A locked section is never hidden.
 */
export function resolveHomeSections(stored: unknown): HomeSections {
  const raw = (stored && typeof stored === "object" ? stored : {}) as { order?: unknown; hidden?: unknown };
  const order: HomeSectionId[] = [];
  for (const id of Array.isArray(raw.order) ? raw.order : []) if (isSectionId(id) && !order.includes(id)) order.push(id);
  for (const id of HOME_SECTION_IDS) if (!order.includes(id)) order.push(id);
  const hidden = (Array.isArray(raw.hidden) ? raw.hidden : []).filter(
    (id, i, all): id is HomeSectionId => isSectionId(id) && !LOCKED_VISIBLE.has(id) && all.indexOf(id) === i,
  );
  return { order, hidden };
}

/** The sections to render, in order. */
export function visibleHomeSections(sections: HomeSections): HomeSectionId[] {
  return sections.order.filter((id) => !sections.hidden.includes(id));
}

/** Move one section up or down by one place; out-of-range moves are no-ops. */
export function moveHomeSection(order: HomeSectionId[], id: HomeSectionId, direction: "up" | "down"): HomeSectionId[] {
  const from = order.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
