-- Member search that also matches services and industry (GAPS A9.5).
--
-- REQUIREMENTS §4 (18 Sep) reconfirmed search as free text over "company name,
-- industry, category, service — anything". /search matched members through
-- `members.search_tsv` alone, and that column is generated from name +
-- description (20260808000004): someone searching "laser cutting" never found
-- a member that merely *offers* laser cutting. A generated column can't read
-- another table, so it can't be widened to cover the `member_services` join or
-- the `industries` name.
--
-- A function rather than a trigger-maintained column: this repo has no
-- triggers (20260825000002 says so), and a derived column kept fresh from
-- app code would drift the first time something wrote services another way.
-- Computing the extra text per query is cheap at a few hundred members.
--
-- Service and industry names are weighted C, below name (A) and description
-- (B), so a company *named* for the term still ranks first. Results now come
-- back in ts_rank order; before this they had no order at all.
--
-- SECURITY INVOKER (the default, stated for the reader): the caller's RLS
-- applies, so anon still sees only what `public_read_active_members` allows —
-- archived members stay hidden — and services/industries are public-read
-- already. `query` must be a to_tsquery string; searchSite builds it with the
-- same escaping it has always used for textSearch.

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
  doc as (
    select
      m.slug, m.name, m.description, m.logo_path,
      m.search_tsv
        || setweight(to_tsvector('english', coalesce(svc.names, '') || ' ' || coalesce(i.name, '')), 'C') as tsv
    from members m
    left join svc on svc.member_id = m.id
    left join industries i on i.id = m.industry_id
    where m.status = 'active'
  )
  select doc.slug, doc.name, doc.description, doc.logo_path
  from doc, q
  where doc.tsv @@ q.tsq
  order by ts_rank(doc.tsv, q.tsq) desc, doc.name
  limit greatest(1, least(max_results, 50));
$$;

-- Public search, so anon keeps execute — but grant it explicitly rather than
-- through PUBLIC's default, per 20260816000002.
revoke execute on function search_members(text, int) from public;
grant execute on function search_members(text, int) to anon, authenticated, service_role;
