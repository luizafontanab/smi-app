/**
 * The canonical Industries list — exactly one per member, driving the industry
 * bar, /industry/* pages and the directory's industry filter. Stored as
 * `categories` rows with kind='member'; a member points at one via
 * members.category_id.
 *
 * Source: docs/ask-jas.md ("Industries (one per member, shown on the industry
 * bar and /industry/* pages)"), transcribed from the live site. It is NOT in
 * the WordPress export — there is no `industry` taxonomy in the source
 * database at all — so per-member assignment has to be derived (industry-map.ts)
 * and confirmed with Jas before go-live (docs/GO-LIVE.md).
 *
 * Shared by both seeds so they cannot drift: seed-real.ts previously wrote the
 * 69-term Services vocabulary here instead, which is what put 69 service names
 * in the industry bar.
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

export const INDUSTRY_ROWS = INDUSTRIES.map((name) => ({ kind: "member", slug: industrySlug(name), name }));
