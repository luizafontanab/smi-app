-- Close two anon write paths that bypassed application-level controls.
--
-- 1) newsletter_signups / inbox_messages had `with check (true)` insert
--    policies (20260808000004) left from before the public forms moved to
--    server actions using the service key. The actions rate-limit and
--    validate; the anon policies let anyone with the publishable key POST
--    /rest/v1/inbox_messages directly and skip both. Every writer now goes
--    through serviceDb() (verified: (public)/actions.ts, lib/membership.ts,
--    lib/jobs.ts), so the policies are dead weight — drop them, and revoke
--    the table-level write grants (20260808000006) as well so a future
--    permissive policy alone can't silently reopen the surface.
--
-- 2) bump_newsletter_metric / bump_consent_stats (20260901000009 / 000011)
--    are `security definer` and were callable by anon via /rest/v1/rpc,
--    repeating the exact bug 20260816000002 fixed for the maintenance
--    functions: `grant execute` there covered only service_role, but
--    Postgres grants EXECUTE to PUBLIC on new functions by default, and
--    20260808000006's default privileges add explicit anon/authenticated
--    execute on top. Revoke from all three; the only real callers go
--    through serviceDb() (api/webhooks/resend, lib/analytics.ts).

drop policy if exists public_insert_signup on newsletter_signups;
drop policy if exists public_insert_inbox on inbox_messages;

revoke insert, update, delete on newsletter_signups from anon, authenticated;
revoke insert, update, delete on inbox_messages from anon, authenticated;

revoke execute on function bump_newsletter_metric(text, text) from public, anon, authenticated;
revoke execute on function bump_consent_stats(boolean) from public, anon, authenticated;

grant execute on function bump_newsletter_metric(text, text) to service_role;
grant execute on function bump_consent_stats(boolean) to service_role;
