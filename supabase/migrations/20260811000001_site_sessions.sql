-- Distinct-session count for the Command Centre "site users" KPI. PostgREST
-- cannot express count(distinct ...), and rollups_daily only fills via the
-- daily job, so the dashboard calls this directly.
create or replace function site_sessions_last_year()
returns bigint
language sql
stable
as $$
  select count(distinct session_hash)
  from analytics_events
  where occurred_at >= now() - interval '1 year'
    and session_hash is not null;
$$;

-- Console-only figure: default privileges grant execute to the API roles.
revoke execute on function site_sessions_last_year() from anon, authenticated;
