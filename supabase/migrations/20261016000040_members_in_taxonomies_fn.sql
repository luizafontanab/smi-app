-- The member directory's taxonomy filters, evaluated in the database (review
-- finding, 16 Oct).
--
-- memberDirectory and memberPins (lib/queries.ts) used to resolve each
-- selected industry / service / membership type to a list of member ids in
-- two steps — fetch every matching join row, then send every id back as
-- `.in("id", [...])` — and both steps break as the directory grows:
--   · the join-row read had no .range(), so PostgREST's max-rows cap (1000)
--     silently truncated it, and members past the cut vanished from the
--     filtered directory and map without any error;
--   · the id list travels in the GET query string, ~37 bytes per uuid, so a
--     broad industry turns into a URL long enough to be refused (414) or cut
--     off by a proxy.
-- Here each axis is an `exists` on its join table, so neither the row cap nor
-- the URL length applies: the slugs go in the POST body of /rpc, and the
-- caller chains its usual select/filters/order onto the result.
--
-- Semantics are the old ones exactly:
--   · within an axis, any selected slug matches (OR);
--   · across axes, every filtered axis must match (AND);
--   · a NULL argument means that axis is not filtering at all;
--   · an empty array matches nothing (`= any('{}')` is false) — the old
--     "filtered to nothing" result.
-- Industries match through member_industries — every industry a member is
-- in, not only the primary in members.industry_id (20261012000001).
--
-- SECURITY INVOKER, like search_members (20260928000001): the caller's RLS
-- applies, so anon still sees only what public_read_active_members allows
-- and the join tables answer only for visible members (20261016000031).
-- Returns `setof members`, so PostgREST can embed on the rows
-- (industry:industries!members_industry_id_fkey) as it does on the table.
-- Execute is public on purpose — the directory is public — but granted
-- explicitly rather than through PUBLIC's default, per 20260816000002.

create or replace function members_in_taxonomies(
  p_industries text[] default null,
  p_services text[] default null,
  p_membership_types text[] default null
)
returns setof members
language sql
stable
security invoker
set search_path = public
as $$
  select m.*
  from members m
  where (p_industries is null or exists (
          select 1 from member_industries mi
          join industries i on i.id = mi.industry_id
          where mi.member_id = m.id and i.slug = any(p_industries)))
    and (p_services is null or exists (
          select 1 from member_services ms
          join services s on s.id = ms.service_id
          where ms.member_id = m.id and s.slug = any(p_services)))
    and (p_membership_types is null or exists (
          select 1 from member_membership_types mmt
          join membership_types t on t.id = mmt.membership_type_id
          where mmt.member_id = m.id and t.slug = any(p_membership_types)));
$$;

revoke execute on function members_in_taxonomies(text[], text[], text[]) from public;
grant execute on function members_in_taxonomies(text[], text[], text[]) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
