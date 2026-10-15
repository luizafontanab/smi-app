-- Members can no longer write member_revisions directly (review finding, 16 Oct).
--
-- member_insert_revision (20260808000004) let any signed-in member insert a
-- revision through PostgREST as long as member_id was their own — with any
-- payload and any status. Approving one applied the payload to `members`
-- wholesale, so a member could set their own status, billing_mode, paid_at,
-- is_bundle_account or archived_at by getting Jas to click Approve on what the
-- console showed only as "submitted edits on {date}".
--
-- The app-side fix is in console/member-revision.ts: Approve now applies only
-- the fields the member's profile form can produce, re-validated, and the
-- console shows Jas the field-by-field changes first. This closes the door the
-- payload came through as well: the only writer is dashboard submitProfileEdit,
-- which inserts with serviceDb() after its own validation, so nothing
-- legitimate uses the policy. Without it RLS denies member inserts outright,
-- and the table-level grant (20260808000006 granted insert to authenticated on
-- every table) is revoked too, so a future permissive policy alone can't reopen
-- it — the same belt-and-braces as 20260901000014.
--
-- member_read_own_revisions stays: the member's submissions list reads it.

drop policy if exists member_insert_revision on member_revisions;
revoke insert, update, delete on member_revisions from anon, authenticated;
