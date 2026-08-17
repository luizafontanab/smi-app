-- Corrects 20260816000001, which did nothing.
--
-- Postgres grants EXECUTE on a newly created function to PUBLIC by default.
-- `revoke ... from anon, authenticated` removes only the explicit per-role
-- grants; both API roles still inherit the privilege through PUBLIC. Verified
-- against the deployed project immediately after 20260816000001 applied — anon
-- could still call run_daily_rollup() (204) and ensure_analytics_partition()
-- (204).
--
-- 20260811000001 has the identical flaw, so site_sessions_last_year() is fixed
-- here too rather than left looking locked when it is not: anon could call it
-- and read the site's rolling-year session count (200, returned a figure).
--
-- Revoking from PUBLIC is what actually removes the privilege. The explicit
-- service_role grants keep the two real callers working — console/page.tsx
-- (site users stat) and lib/jobs.ts (rollup_daily) both go through serviceDb().

revoke execute on function run_daily_rollup() from public;
revoke execute on function ensure_analytics_partition(date) from public;
revoke execute on function site_sessions_last_year() from public;

grant execute on function run_daily_rollup() to service_role;
grant execute on function ensure_analytics_partition(date) to service_role;
grant execute on function site_sessions_last_year() to service_role;
