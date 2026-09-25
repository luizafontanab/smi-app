-- Archive a member without deleting them (fix-list 72).
--
-- WHY A COLUMN AND NOT A STATUS. `member_status` is a real Postgres enum
-- ('draft','active','grace','lapsed') and it describes where a member sits in
-- the billing lifecycle. Archiving is orthogonal to that — an active member and
-- a lapsed one can both be archived, and an archived member who comes back
-- should return to whatever status they had. Adding a fifth enum value would
-- also break every exhaustive `Record<MemberStatus, …>` in the app and add a
-- filter tab and a dropdown option in places where archiving needs to be a
-- deliberate button, not a status someone picks by accident.
--
-- HOW THE HIDING WORKS. `public_read_active_members` (20260808000004) is the
-- only restraint on anon reads of this table — 20260808000006_grants.sql hands
-- anon and authenticated full DML, so the policy is the gate. Folding
-- `archived_at is null` into that policy hides an archived member from the
-- directory, the map, search, the sitemap AND every embedded
-- `member:members(...)` join in one place. That last part is what makes this the
-- right lever: VIDEO_CARD and EVENT_FIELDS in queries.ts never select `status`,
-- so their bylines could not be gated in application code even if we wanted to —
-- under this policy the embedded member comes back null and the existing
-- `{video.member && …}` guards hide the byline with no component change.
--
-- Paths using serviceDb() bypass RLS by design and are filtered in code instead:
-- activePlacements, activeTakeover, /go/[memberId] and the stats/lead jobs.

alter table members add column if not exists archived_at timestamptz;

comment on column members.archived_at is
  'Set by the console to hide a member from the public site without deleting them. '
  'Content they are tagged on survives; the byline and the link to their page stop '
  'rendering. Null means not archived. Orthogonal to status.';

drop policy if exists public_read_active_members on members;
create policy public_read_active_members on members for select
  using (status in ('active', 'grace') and archived_at is null);

-- The common read is "not archived", so index only those rows.
create index if not exists members_not_archived_idx
  on members (status) where archived_at is null;
