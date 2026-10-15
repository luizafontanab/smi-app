/**
 * WordPress `post_tag` terms that are not news topics.
 *
 * `categories` is seeded from WP's post tags (WP's own categories are 99%
 * "Uncategorized"). Tags there were free text in WP-admin, and WP keeps a term
 * after nothing uses it any more, so the export carries typos and one-offs
 * alongside the real taxonomy: `waer`, `financw`, `filrat`, a member's
 * accreditations page tagged twice under two spellings. The handover extract
 * copies every tag unfiltered (handover-extract/scripts/shape-seed.ts), so
 * they reached local, staging and production through seed-real.ts.
 *
 * An explicit list rather than a usage threshold: `waer` and `rolls` are used
 * once each, while real-but-quiet topics like "Extrusion Machines" are used
 * zero times. Decided by Luiza, 4 Oct 2026; `exhibitions` looked like junk but is
 * a real topic and stays.
 *
 * Migration 20261004000001_prune_junk_categories.sql deletes the same slugs
 * from existing databases — if you change one, change both.
 */
export const JUNK_TAG_SLUGS: ReadonlySet<string> = new Set([
  "waer",
  "financw",
  "filrat",
  "rolls",
  "news",
  "materials-supplier",
  "saint-anns-sheet-metal-company-accreditations",
  "saintanns-sheet-metal-company-accreditations",
]);

/** Drops the junk tags; everything else passes through unchanged and in order. */
export const newsTopics = <T extends { slug: string }>(rows: T[]): T[] =>
  rows.filter((r) => !JUNK_TAG_SLUGS.has(r.slug));
