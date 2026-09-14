-- Industries become their own table, and content links to them directly.
--
-- `categories` held two unrelated vocabularies behind a `kind` discriminator:
-- kind='member' was the 10-item Industries list (one per member, via
-- members.category_id) and kind='story' the news topics (many per story, via
-- story_categories). Naming a table after one of the two things it holds made
-- every call site read `.eq("kind", …)` to say which vocabulary it meant, and
-- put the industry bar one bad seed away from rendering the wrong list — which
-- is exactly what happened (see 20260909000001_member_services.sql).
--
-- Also reverses the "no direct story→industry taxonomy" note in docs/GAPS.md
-- ("Not gaps — deferred by design"): news, videos and events now carry their
-- own industry_id instead of inheriting one through stories.member_id →
-- members.category_id. Re-decided by Luiza, 9 Sep 2026.
--
-- Production note: this file is written to be correct on a broken production
-- database as well as a fixed local one. Prod's categories kind='member' rows
-- are the 69 WordPress *Services* terms, not industries — step 4 rescues them
-- into `services` before step 8 deletes them. Per-member industry assignment
-- is NOT done here: it is derived from the WordPress export, which SQL cannot
-- reach (scripts/seed-real.ts --taxonomies-only).

-- 1. The table, and the canonical list (shared with scripts/lib/industries.ts,
--    which must stay in step with these slugs). Same inline-rows shape as
--    20260904000001_membership_types.sql.
create table industries (
  id serial primary key,
  slug text not null unique,
  name text not null,
  sort_order int not null default 0
);

insert into industries (slug, name, sort_order) values
  ('automation-robotics',  'Automation & Robotics',  1),
  ('fabrication',          'Fabrication',            2),
  ('finishing-coating',    'Finishing & Coating',    3),
  ('laser-cutting',        'Laser Cutting',          4),
  ('machinery-sales',      'Machinery Sales',        5),
  ('press-brakes',         'Press Brakes',           6),
  ('service-maintenance',  'Service & Maintenance',  7),
  ('software',             'Software',               8),
  ('tube-bending',         'Tube Bending',           9),
  ('welding',              'Welding',               10);

-- 2. Public data, like every other lookup table.
alter table industries enable row level security;
create policy public_read_industries on industries for select using (true);

-- 3. The direct links. Nullable: ~7% of members resolve to no industry, and
--    editorial content that belongs to no single industry is normal.
--    members.category_id never had an index — fixing that here too.
alter table members add column industry_id int references industries(id);
alter table stories add column industry_id int references industries(id);
alter table videos  add column industry_id int references industries(id);
alter table events  add column industry_id int references industries(id);

create index members_industry_idx on members (industry_id);
create index stories_industry_idx on stories (industry_id);
create index videos_industry_idx  on videos  (industry_id);
create index events_industry_idx  on events  (industry_id);

-- 4. Rescue any kind='member' row that is NOT an industry into `services`,
--    before step 8 deletes them. No-op on a correct local database; on
--    production this is the only thing preserving the 69 Services terms.
--    The `not in` guard matters: 'automation-robotics' is a slug in both lists.
insert into services (slug, name)
  select slug, name from categories
   where kind = 'member' and slug not in (select slug from industries)
  on conflict (slug) do nothing;

-- 5. Carry over each member's existing assignment by slug. Complete on a
--    correct local database; on production this matches only the members
--    pointing at 'automation-robotics', and the rest stay null until the
--    derivation script runs.
update members m set industry_id = i.id
  from categories c
  join industries i on i.slug = c.slug
 where m.category_id = c.id and c.kind = 'member';

-- 6. Content inherits from its member — the same value the old
--    stories.member_id → members.category_id join computed, now materialised.
--    Content with no member (most of the archive) keeps a null industry.
update stories s set industry_id = m.industry_id from members m where s.member_id = m.id;
update videos  v set industry_id = m.industry_id from members m where v.member_id = m.id;
update events  e set industry_id = m.industry_id from members m where e.member_id = m.id;

-- 7. Scrub the dropped key out of pending revision payloads: decideRevision
--    spreads the stored payload into members.update(), which would fail on an
--    unknown column. Same treatment testimonials got in 20260902000003.
update member_revisions set payload = payload - 'category_id' where payload ? 'category_id';

-- 8. Drop the old shape. `categories` is now news topics only, so the
--    discriminator and its composite unique go with it.
alter table members drop column category_id;
delete from categories where kind = 'member';
alter table categories drop constraint categories_kind_slug_key;
alter table categories add constraint categories_slug_key unique (slug);
alter table categories drop column kind;
drop type category_kind;

notify pgrst, 'reload schema';
