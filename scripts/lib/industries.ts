/**
 * The canonical Industries list — exactly one per member, driving the industry
 * bar, /industry/* pages and the directory's industry filter. Stored in the
 * `industries` table; members, stories, videos and events each point at one via
 * their own `industry_id` (migration 20260909000002).
 *
 * The rows are also inserted by that migration, so production gets the list
 * from `db:push:prod` alone. This constant keeps the seeds in step with it —
 * if you change one, change both.
 *
 * Source: docs/ask-jas.md ("Industries (one per member, shown on the industry
 * bar and /industry/* pages)"), transcribed from the live site. It is NOT in
 * the WordPress export — there is no `industry` taxonomy in the source
 * database at all — so per-member assignment has to be derived (industry-map.ts)
 * and confirmed with Jas before go-live (docs/GO-LIVE.md).
 *
 * Shared by both seeds so they cannot drift: seed-real.ts previously wrote the
 * 69-term Services vocabulary into the industry list instead, which is what put
 * 69 service names in the industry bar.
 */
export const INDUSTRIES = [
  "Automation & Robotics",
  "Fabrication",
  "Finishing & Coating",
  "Laser Cutting",
  "Machinery Sales",
  "Press Brakes",
  "Service & Maintenance",
  "Software",
  "Tube Bending",
  "Welding",
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
