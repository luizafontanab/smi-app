-- A member's story views, counted so they can only grow (review finding,
-- 16 Oct; USE-CASES Gap 6: the cumulative figure "can never drop").
--
-- /dashboard/stats counted story views over the stories that *currently* both
-- tag the member (story_members) and are published, by passing their ids to
-- PostgREST as `story_id=in.(…)`. Two faults:
--   · it went DOWN when the desk unpublished a story or retagged it — views
--     that really happened stopped counting, on the one figure promised to be
--     monotonic;
--   · the id list rode in the request URL, unbounded — a member featured in a
--     few hundred stories would overrun it.
--
-- What the data can support: every story_view event carries the story and the
-- story's primary member AT VIEW TIME (news/[slug] records story.member_id),
-- and analytics_events is never pruned or rewritten. So a view is credited to
-- a member when
--   (a) they were the story's primary member when it was read — fixed forever,
--       whatever happens to the story afterwards; or
--   (b) the story features them now (story_members, the primary included),
--       whatever its status — which credits a co-featured member with views
--       from before they were tagged, as the page already did.
-- Neither depends on the story's current status, so unpublishing no longer
-- costs anyone views. The one way the figure can still fall: a member tagged
-- *alongside* the primary and later untagged loses (b) — there is no history
-- of past tags to credit them from. That is reported for Jas (ask-jas) rather
-- than papered over.
--
-- Counted in the database, like member_event_months (20260928000004): the
-- all-time and 30-day tiles from the raw events (exact; head counts were
-- exact before too), the month-by-month chart from rollups_daily, which
-- run_daily_rollup groups by story_id and member_id, so the same two rules
-- apply to it unchanged.
--
-- The story_id index: the old query filtered on story_id with nothing to
-- serve it, and (b) does the same. Partitioned parent — it cascades to every
-- monthly partition, existing and future.
--
-- service_role only: the stats page calls these through serviceDb with the
-- signed-in member's own id; nobody else may read a member's numbers by
-- passing theirs.

create index if not exists analytics_events_story_idx
  on analytics_events (story_id, occurred_at) where story_id is not null;

create or replace function member_story_view_count(p_member uuid, p_since timestamptz default null)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)
  from analytics_events e
  where e.kind = 'story_view'
    and (p_since is null or e.occurred_at >= p_since)
    and (
      e.member_id = p_member
      or e.story_id in (select sm.story_id from story_members sm where sm.member_id = p_member)
    );
$$;

create or replace function member_story_view_months(p_member uuid, p_since date)
returns table (month text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select to_char(r.day, 'YYYY-MM') as month, sum(r.count)::bigint as n
  from rollups_daily r
  where r.kind = 'story_view'
    and r.day >= p_since
    and (
      r.member_id = p_member
      or r.story_id in (select sm.story_id from story_members sm where sm.member_id = p_member)
    )
  group by 1;
$$;

revoke execute on function member_story_view_count(uuid, timestamptz) from public, anon, authenticated;
grant execute on function member_story_view_count(uuid, timestamptz) to service_role;
revoke execute on function member_story_view_months(uuid, date) from public, anon, authenticated;
grant execute on function member_story_view_months(uuid, date) to service_role;

notify pgrst, 'reload schema';
