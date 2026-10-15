-- Jas's ten industries replace ours, and a member can belong to several.
--
-- The list 20260909000002 inserted (Automation & Robotics … Welding) was
-- invented during development — the WordPress site has no industry taxonomy —
-- and every assignment since came from a guessed Services → industry table
-- flagged "DEV-ONLY ASSUMPTION" (scripts/lib/industry-map.ts as it was). Jas
-- sent his own list on 12 Oct 2026, with a mapping from every Service and news
-- category to one of his industries. Closes GO-LIVE 1.1's list question,
-- supersedes HUMAN-TODO 12.3/12.4, and finalises USE-CASES #19's naming.
--
-- Members: most offer services spanning several industries (85 of the 115
-- whose services map anywhere span two to five), so one-per-member threw most
-- of that away. `member_industries` holds the full set and drives the
-- directory filter and /industry/* member lists; `members.industry_id` stays as
-- the member's primary industry, shown on their card and profile and inherited
-- by content forms. Decided by Luiza, 12 Oct 2026. Stories, videos and events
-- keep exactly one industry each.
--
-- Clear and recompute, not remap: every existing industry_id is a dev guess,
-- and the old ten don't map cleanly onto the new ones. This migration clears
-- them; `pnpm industries:backfill` (scripts/backfill-industries.ts) re-derives
-- all of them from Jas's mapping against the services and categories already in
-- the database. Run it immediately after this migration — until then nothing
-- has an industry and /industry/* pages are empty. The site isn't public yet
-- (production serves the holding page), so the slug changes need no redirects.
--
-- A second members ↔ industries relationship makes PostgREST's bare
-- `industry:industries(...)` embed on members ambiguous (PGRST201). Every such
-- embed now names `members_industry_id_fkey`; tests/unit/member-industry-embed
-- guards it, as story-member-embed does for the story_members precedent.

-- 1. The join table. industry_id is RESTRICT like the four industry_id columns,
--    so deleteIndustry's "still in use" guard stays true; members cascade like
--    member_services.
create table member_industries (
  member_id uuid not null references members(id) on delete cascade,
  industry_id int not null references industries(id),
  primary key (member_id, industry_id)
);

create index member_industries_industry_idx on member_industries (industry_id);

-- 2. Public data, like member_services. No write policies: the console,
--    the member area and the backfill all write through the service role.
alter table member_industries enable row level security;
create policy public_read_member_industries on member_industries for select using (true);

-- 3. Clear every assignment so the old rows can go. Nothing is lost that
--    wasn't derived: see the header.
update members set industry_id = null where industry_id is not null;
update stories set industry_id = null where industry_id is not null;
update videos  set industry_id = null where industry_id is not null;
update events  set industry_id = null where industry_id is not null;

-- 4. Pending profile revisions carry an industry_id that is about to stop
--    existing; decideRevision spreads the payload into members.update(), so
--    approving one would fail the foreign key. The rest of each revision is
--    kept. Same treatment as 20260909000002 step 7.
update member_revisions set payload = payload - 'industry_id' where payload ? 'industry_id';

-- 5. Swap the list. Unconditional, so any industry hand-added in the console
--    goes too. Shared with scripts/lib/industries.ts — change both together.
delete from industries;

insert into industries (slug, name, sort_order) values
  ('automation-robotics',          'Automation & Robotics',            1),
  ('inspection-measurement',       'Inspection & Measurement',         2),
  ('grinding-surface-finishing',   'Grinding & Surface Finishing',     3),
  ('processing-technology',        'Processing Technology',            4),
  ('machinery-tools-equipment',    'Machinery, Tools & Equipment',     5),
  ('software-it-services',         'Software & IT Services',           6),
  ('bending-forming',              'Bending & Forming',                7),
  ('welding-joining',              'Welding & Joining',                8),
  ('subcontractor-news',           'Subcontractor News',               9),
  ('events-open-houses-education', 'Events, Open Houses & Education', 10);

-- 6. Member search matches every industry a member is in, not just the
--    primary. Otherwise unchanged from 20260928000001.
create or replace function search_members(query text, max_results int default 10)
returns table (slug text, name text, description text, logo_path text)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select to_tsquery('english', query) as tsq
  ),
  svc as (
    select ms.member_id, string_agg(s.name, ' ') as names
    from member_services ms
    join services s on s.id = ms.service_id
    group by ms.member_id
  ),
  ind as (
    select mi.member_id, string_agg(i.name, ' ') as names
    from member_industries mi
    join industries i on i.id = mi.industry_id
    group by mi.member_id
  ),
  doc as (
    select
      m.slug, m.name, m.description, m.logo_path,
      m.search_tsv
        || setweight(to_tsvector('english', coalesce(svc.names, '') || ' ' || coalesce(ind.names, '')), 'C') as tsv
    from members m
    left join svc on svc.member_id = m.id
    left join ind on ind.member_id = m.id
    where m.status = 'active'
  )
  select doc.slug, doc.name, doc.description, doc.logo_path
  from doc, q
  where doc.tsv @@ q.tsq
  order by ts_rank(doc.tsv, q.tsq) desc, doc.name
  limit greatest(1, least(max_results, 50));
$$;

revoke execute on function search_members(text, int) from public;
grant execute on function search_members(text, int) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
