-- Members can no longer insert content rows straight through PostgREST
-- (16 Oct code review).
--
-- Five insert policies date from the first RLS pass (20260808000004, with
-- events re-created in 20260827000001 and videos added in 20260826000001),
-- when the member area was going to write with the member's own session. It
-- never did: every member write is a server action on the service role
-- (src/app/dashboard/actions.ts), behind requireMember() and an ownership
-- check, and the only member-session calls left in src/ are auth ones
-- (sign-in, sign-out, password and email change).
--
-- So the policies were a second, unguarded door. A member holding their own
-- access token and the public publishable key could insert:
--   * a member_revisions row with any payload — which decideRevision used to
--     spread straight into members.update(), so approving "an edit" could set
--     status, billing_mode, paid_at or is_bundle_account (now also allowlisted
--     in decideRevision itself);
--   * stories, events and videos whose body never went through the
--     sanitiser, and that skipped the actions' validation and notifications;
--   * visibility_requests that skipped the server action entirely.
--
-- member_revisions was already closed by 20261016000011 (which also revokes
-- the table privileges); it's repeated here, idempotently, so this file reads
-- as the complete list.
--
-- With the policies gone, RLS denies these inserts for anon and authenticated
-- alike; the service role is unaffected. The read policies stay. A future
-- feature that genuinely writes with a member session needs its own policy,
-- written for that feature.

drop policy if exists member_insert_story on stories;
drop policy if exists member_insert_event on events;
drop policy if exists member_insert_video on videos;
drop policy if exists member_insert_revision on member_revisions;
drop policy if exists member_insert_visibility_request on visibility_requests;
