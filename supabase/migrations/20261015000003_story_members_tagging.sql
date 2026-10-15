-- Several members per story, with full reach (Jas feedback 13/10/26, item 12:
-- "Sometimes in stories we feature multiple members, all need to be tagged to
-- ensure the story is added to the individual member profiles and library").
-- Scope decided by Luiza 14 Oct: admins tag; every tagged member gets the story
-- on their profile, read-only in their dashboard, in their stats, a "story
-- featuring you is live" notification, and their handles in the social post.
--
-- story_members (20260924000001) already holds the links — the import filled it
-- from WordPress's link_a_member, primary included — but no app code read or
-- wrote it. It now becomes the single source of truth for "every member this
-- story features", PRIMARY INCLUDED, the same shape member_industries took on
-- 12 Oct. stories.member_id stays as the primary: who the story leads with,
-- who owns it (edit/withdraw rights, ownership checks) and who gets story_live.
--
-- 1. Backfill: stories created in the app since the import never wrote the
--    table, so their primary isn't in it yet. Idempotent.
--
-- 2. analytics_events (story_id, occurred_at): a co-tagged member's story views
--    are counted by story (dashboard/stats), not by the member_id stamped on the
--    event at view time — that holds only the primary. Without this index those
--    counts scan every story view. Created on the partitioned parent, so it
--    propagates to every partition (plain, not CONCURRENTLY — not allowed on a
--    partitioned table).
--
-- 3. Read policy: was `using (true)`, which exposed the member pairings of
--    unpublished stories — drafts included — to anon. The public site only ever
--    needs published pairings; everything else reads with the service role.
--    The subquery runs under the caller's own stories RLS.

insert into story_members (story_id, member_id)
select id, member_id from stories where member_id is not null
on conflict (story_id, member_id) do nothing;

create index if not exists analytics_events_story_idx
  on analytics_events (story_id, occurred_at) where story_id is not null;

drop policy if exists public_read_story_members on story_members;
create policy public_read_story_members on story_members for select
  using (exists (select 1 from stories s where s.id = story_members.story_id and s.status = 'published'));
