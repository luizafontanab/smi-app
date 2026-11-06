-- Corrects 20261105000003, which left social_waiting_items() callable by the
-- API roles.
--
-- Revoking from PUBLIC (20260816000002's lesson) isn't enough here: Supabase's
-- default privileges on schema public also grant EXECUTE on each new function
-- to anon and authenticated by name. Checked on the local stack straight after
-- 20261105000003 applied — has_function_privilege('anon', …) was true, and a
-- `set role anon` call returned rows. Same fix as
-- 20261016000034_contacts_lowercase_email.sql. The function's only callers go
-- through the service role (src/lib/social-post.ts socialWaiting), which keeps
-- its grant.

revoke execute on function social_waiting_items(text[], integer, timestamptz) from anon, authenticated;
