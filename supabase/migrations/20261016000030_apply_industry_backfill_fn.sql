-- The industry backfill writes in one transaction.
--
-- scripts/lib/industry-backfill.ts used to apply its plan as ~20 separate
-- PostgREST calls: clear member_industries and every industry_id on members,
-- stories, videos and events, then write the new values back table by table.
-- Nothing tied those calls together, so a failure part-way (a dropped
-- connection, a foreign key, PostgREST's own limits) left production with some
-- tables recomputed, some half-written and some simply empty — every
-- /industry/* page blank. And the empty state was not the worst of it: the
-- retry then needed --overwrite, because the guard saw the half-written rows
-- and took them for hand-picked ones.
--
-- This function applies the whole plan inside the single transaction a
-- PostgREST RPC call runs in. It either lands completely or not at all, so a
-- failed run leaves the target exactly as it was and is simply run again.
--
-- Shape of `plan` — the BackfillPlan the script computes, minus its report:
--   { "links":   [{ "member_id": uuid, "industry_id": int }, ...],
--     "members": [{ "id": uuid, "industry_id": int | null }, ...],
--     "stories": [...], "videos": [...], "events": [...] }
-- Every key is required; a missing one raises rather than being read as
-- "nothing to assign", which would clear that table.
--
-- Same semantics as the old sequence: member_industries is replaced outright
-- (it holds nothing the plan does not recompute), and each listed row's
-- industry_id is set to the plan's value, null included. Rows only touched
-- when the value actually changes, so a re-run on an unchanged target writes
-- nothing. A row created after the script read the target is not in the plan
-- and is left alone.
--
-- Invoker rights and service_role only: the backfill and both seeds run with
-- the secret key, and nothing else has any business recomputing every
-- industry on the site.

create or replace function apply_industry_backfill(plan jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  k text;
begin
  foreach k in array array['links', 'members', 'stories', 'videos', 'events'] loop
    if jsonb_typeof(plan -> k) is distinct from 'array' then
      raise exception 'apply_industry_backfill: plan.% must be an array', k;
    end if;
  end loop;

  -- `where` only because PostgREST sessions may run pg-safeupdate, which
  -- refuses an unqualified delete; this matches every row.
  delete from member_industries where member_id is not null;
  insert into member_industries (member_id, industry_id)
    select l.member_id, l.industry_id
      from jsonb_to_recordset(plan -> 'links') as l(member_id uuid, industry_id int)
    on conflict (member_id, industry_id) do nothing;

  update members t set industry_id = p.industry_id
    from jsonb_to_recordset(plan -> 'members') as p(id uuid, industry_id int)
   where t.id = p.id and t.industry_id is distinct from p.industry_id;
  update stories t set industry_id = p.industry_id
    from jsonb_to_recordset(plan -> 'stories') as p(id uuid, industry_id int)
   where t.id = p.id and t.industry_id is distinct from p.industry_id;
  update videos t set industry_id = p.industry_id
    from jsonb_to_recordset(plan -> 'videos') as p(id uuid, industry_id int)
   where t.id = p.id and t.industry_id is distinct from p.industry_id;
  update events t set industry_id = p.industry_id
    from jsonb_to_recordset(plan -> 'events') as p(id uuid, industry_id int)
   where t.id = p.id and t.industry_id is distinct from p.industry_id;
end;
$$;

revoke execute on function apply_industry_backfill(jsonb) from public;
revoke execute on function apply_industry_backfill(jsonb) from anon, authenticated;
grant execute on function apply_industry_backfill(jsonb) to service_role;

notify pgrst, 'reload schema';
