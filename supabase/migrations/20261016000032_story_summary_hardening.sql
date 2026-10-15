-- story_summary (20261015000004) gets the two settings every other function
-- here has (review finding, 16 Oct; the rule is in .claude/skills/db-change).
--
--   · search_path pinned to public. It is unset today, so the function resolves
--     `stories`, btrim, regexp_replace and the rest against whatever search_path
--     the calling session has — the standard function-hijack opening, and the
--     reason 20260816000002 exists.
--   · EXECUTE revoked from PUBLIC. Postgres grants it to PUBLIC by default on
--     create; 20261015000004 only added grants on top of that, so every role in
--     the database could call it, not just the three meant to.
--
-- The explicit grants stay: story_summary is a PostgREST computed field
-- (`excerpt:story_summary` in STORY_CARD and the newsletter reads), so anon and
-- authenticated must be able to execute it or every story card fails to load.
-- Re-granted here so the result is right whatever order these ran in.
--
-- ALTER rather than create-or-replace, so the body stays exactly as
-- 20261015000004 wrote it.

alter function story_summary(stories) set search_path = public;

revoke execute on function story_summary(stories) from public;
grant execute on function story_summary(stories) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
