-- Migration 0006 sets `alter default privileges ... grant execute on functions
-- to anon, authenticated`, which silently covers every function created by a
-- LATER migration. site_sessions_last_year() was revoked explicitly when it was
-- added (20260811000001); these two were not, so they are reachable over the
-- REST API by any unauthenticated caller.
--
-- run_daily_rollup() is the sharper edge: it is `security definer`, so it runs
-- with the owner's rights and does a full aggregate pass plus partition DDL.
-- ensure_analytics_partition() is DDL on demand. Neither is ever called from
-- the client — jobs run under the service key (src/lib/jobs.ts).

revoke execute on function run_daily_rollup() from anon, authenticated;
revoke execute on function ensure_analytics_partition(date) from anon, authenticated;
