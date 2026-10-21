-- Gap review area 5, slice C (GAPS B5.9): clicks from a newsletter issue,
-- per issue, for the SOP's post-send report (Step 5: top stories, and each
-- advert's clicks, to the editor and the advertisers at S + 7).
--
-- Newsletter links now carry the issue: `/visit/{advert}?src=newsletter&
-- issue=…&slot=…` for adverts, `?src=newsletter&issue=…` on story and video
-- links. /visit and the story/video pages record it here on the event they
-- already write (ad_click, story_view, video_view / page_view).
--
-- A plain uuid, no foreign key: analytics_events is partitioned by month and
-- never rewritten, and the writer checks the issue exists before recording
-- it. A foreign key would turn a mistyped or deleted issue id into a failed
-- insert — and record() inserts a batch as one statement, so the click itself
-- would be lost. A deleted issue just leaves its ids pointing nowhere.
--
-- Counting obeys the analytics consent the rest of the site does: a reader
-- who never accepted the analytics cookie isn't recorded (lib/analytics), so
-- these are clicks from consenting readers, not all clicks. The report says so.

alter table analytics_events add column if not exists newsletter_issue_id uuid;

-- Partitioned parent: cascades to every monthly partition, existing and future.
create index if not exists analytics_events_newsletter_issue_idx
  on analytics_events (newsletter_issue_id, kind) where newsletter_issue_id is not null;

-- One row per thing clicked: stories by story_id, adverts by advert_id, and
-- anything else (videos) by path. `visitors` is distinct session_hash, so one
-- reader clicking twice counts once there.
create or replace function newsletter_issue_clicks(p_issue uuid)
returns table (kind text, story_id uuid, advert_id uuid, path text, clicks bigint, visitors bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.kind,
    e.story_id,
    e.advert_id,
    case when e.story_id is null and e.advert_id is null then e.path end as path,
    count(*) as clicks,
    count(distinct e.session_hash) as visitors
  from analytics_events e
  where e.newsletter_issue_id = p_issue
    and e.kind in ('ad_click', 'story_view', 'video_view', 'page_view')
  group by 1, 2, 3, 4
  order by count(*) desc
$$;

-- service_role only (20260816000002 explains why revoking from PUBLIC is the
-- part that matters): the console issue page calls it through serviceDb.
revoke execute on function newsletter_issue_clicks(uuid) from public;
grant execute on function newsletter_issue_clicks(uuid) to service_role;
