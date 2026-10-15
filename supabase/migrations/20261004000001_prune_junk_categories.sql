-- Remove WordPress tag junk from `categories` (news topics).
--
-- `categories` is seeded from WP's `post_tag` terms. Tags there were free text
-- in WP-admin and WP keeps a term after nothing uses it, so the export carries
-- typos and one-offs next to the real taxonomy. The handover extract copied
-- every tag unfiltered and seed-real.ts upserted all 44, on local and on
-- production (HUMAN-TODO §12 records prod at "categories 44").
--
-- Explicit slugs, not a usage threshold: `waer` and `rolls` are each used once
-- in WP, while real-but-quiet topics ("Extrusion Machines") are used zero
-- times and stay, as does `exhibitions` (lowercase, unused, but a real topic).
-- Decided by Luiza, 4 Oct 2026.
--
-- story_categories cascades, so a story tagged with one of these loses that
-- tag and nothing else. Idempotent: rerunning deletes nothing.
--
-- The seeds skip the same slugs via scripts/lib/news-topics.ts — if you change
-- one, change both.
delete from categories where slug in (
  'waer',
  'financw',
  'filrat',
  'rolls',
  'news',
  'materials-supplier',
  'saint-anns-sheet-metal-company-accreditations',
  'saintanns-sheet-metal-company-accreditations'
);
