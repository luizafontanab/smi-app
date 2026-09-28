-- A `video_view` analytics event, attributed to the video's member (GAPS A9.2).
--
-- The 18 Sep direction for the member stats page (USE-CASES Gap 6, REQUIREMENTS
-- §9) is one "Content reach" figure across adverts, stories, videos and social
-- shares, broken out by content type. Video views were never attributable: the
-- video page recorded a bare `page_view` with no member and no video id, so a
-- member's videos contributed nothing anyone could count.
--
-- Only the kind needs adding. The event carries the video's `member_id`, and
-- run_daily_rollup() already groups every kind by member_id into rollups_daily
-- (20260901000010), so per-member monthly video reach falls out of the
-- existing rollup with no function change. The site-wide `page_view` for the
-- same request is still recorded, so traffic numbers don't move.
--
-- History cannot be recovered: video views before this migration have no
-- member, so a member's video reach starts from the day this ships. The stats
-- page says so rather than implying a quiet past.
--
-- Partitioned parent: the constraint propagates to every monthly partition, as
-- in 20260901000008, whose list this repeats with one addition.

alter table analytics_events drop constraint if exists analytics_events_kind_check;
alter table analytics_events add constraint analytics_events_kind_check
  check (kind in (
    'page_view', 'story_view', 'member_page_view', 'ad_impression', 'ad_click',
    'outbound_click', 'phone_click', 'email_click', 'social_click', 'video_view'
  ));
