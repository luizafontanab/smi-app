-- Video detail pages. The old site published 571 of them at /video/{slug}; ours
-- only ever rendered cards that linked straight out to YouTube, so `videos` had
-- no slug to address a page by and no prose to put on one.
alter table videos
  add column slug text,
  add column description text;

-- Backfill from the title, mirroring the slugify in scripts/seed.ts: strip HTML
-- entities, collapse everything non-alphanumeric to single hyphens, trim, cap at
-- 80 chars. Duplicate titles are real (three "How much does the first cut
-- matter" videos on the live site), so collisions get a -2, -3 … suffix from
-- row_number rather than failing the unique index below.
with slugged as (
  select
    id,
    left(
      trim(both '-' from regexp_replace(
        regexp_replace(lower(title), '&[a-z0-9#]+;', '', 'g'),
        '[^a-z0-9]+', '-', 'g'
      )),
      80
    ) as base,
    row_number() over (
      partition by left(
        trim(both '-' from regexp_replace(
          regexp_replace(lower(title), '&[a-z0-9#]+;', '', 'g'),
          '[^a-z0-9]+', '-', 'g'
        )),
        80
      )
      order by created_at, id
    ) as n
  from videos
)
update videos v
set slug = case when s.n = 1 then s.base else s.base || '-' || s.n end
from slugged s
where v.id = s.id;

-- A row whose title is entirely punctuation slugifies to the empty string; fall
-- back to the id so the not-null below cannot fail on real data.
update videos set slug = id::text where slug is null or slug = '';

alter table videos alter column slug set not null;
create unique index videos_slug_key on videos (slug);
