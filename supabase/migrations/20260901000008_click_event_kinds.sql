-- A5.6 / A5.10: outbound website, phone, email and per-platform social clicks
-- off the member profile, alongside the existing ad_click/ad_impression kinds.
-- This is a partitioned parent table — constraint and column DDL here
-- propagates to every existing/future monthly partition automatically.
alter table analytics_events drop constraint if exists analytics_events_kind_check;
alter table analytics_events add constraint analytics_events_kind_check
  check (kind in (
    'page_view', 'story_view', 'member_page_view', 'ad_impression', 'ad_click',
    'outbound_click', 'phone_click', 'email_click', 'social_click'
  ));

-- Only meaningful for kind = 'social_click' (e.g. 'linkedin', 'facebook').
alter table analytics_events add column if not exists platform text;
