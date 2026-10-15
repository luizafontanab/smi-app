/**
 * The canonical Industries list, driving the industry bar, /industry/* pages
 * and every `?industry=` filter. Stored in the `industries` table. A member
 * belongs to several (`member_industries`) and keeps one primary
 * (`members.industry_id`); stories, videos and events each point at one via
 * their own `industry_id`.
 *
 * The rows are also inserted by migration 20261012000001, so production gets
 * the list from `db:push:prod` alone. This constant keeps the seeds in step
 * with it — if you change one, change both.
 *
 * Source: Jas's spreadsheet of 12 Oct 2026 (tab 1), replacing the ten we
 * invented during development. Names are his words with the punctuation tidied
 * ("Automation/ Robotics" → "Automation & Robotics"); order is his. His note on
 * the tab: "can be fewer, more would break the design" — the industry bar is
 * laid out for at most ten.
 *
 * Shared by both seeds so they cannot drift: seed-real.ts previously wrote the
 * 69-term Services vocabulary into the industry list instead, which is what put
 * 69 service names in the industry bar.
 */
export const INDUSTRIES = [
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
] as const;

export type Industry = (typeof INDUSTRIES)[number];

/** Matches the slugify both seed scripts use, so slugs stay stable across them. */
export const industrySlug = (name: string) =>
  name.toLowerCase().replace(/&[a-z0-9#]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Rows for the `industries` table. sort_order matches the migration's, 1-based. */
export const INDUSTRY_ROWS = INDUSTRIES.map((name, i) => ({
  slug: industrySlug(name),
  name,
  sort_order: i + 1,
}));
