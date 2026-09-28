-- Per-month event counts for a member's stats page, counted in the database
-- (GAPS A9.2 finding).
--
-- /dashboard/stats read a year of raw `ad_impression` and click rows and
-- counted them in JS. PostgREST caps every response at max_rows (1000,
-- supabase/config.toml), so past that the Advert impressions and Clicks
-- overview charts — the numbers a paying member is shown — silently
-- under-counted, with no error. jobs.ts:496 warns about exactly this.
--
-- This returns one row per (month, kind, bucket) instead: at most 12 × 9 rows
-- whatever the traffic. It keeps the page's own rules exactly, so the charts
-- don't move for anyone under the cap:
--   · months are UTC calendar months (the page sliced ISO timestamps, which
--     PostgREST returns in UTC);
--   · impressions are the member's adverts' `ad_impression` events, bucketed
--     by where they appeared: path '/' → 'Homepage', any other path starting
--     '/' → 'Other pages', anything else (no path, 'newsletter') → excluded;
--   · clicks are the five click kinds carrying this member's member_id, with
--     the kind itself as the bucket (the page maps kinds to channel labels).
--
-- Console/service only. The stats page calls it through serviceDb with the
-- signed-in member's own id, like every other query on that page; anon and
-- authenticated can't call it at all, so no caller can read another member's
-- numbers by passing their id.

create or replace function member_event_months(p_member uuid, p_since timestamptz)
returns table (month text, kind text, bucket text, n bigint)
language sql
stable
set search_path = public
as $$
  select month, kind, bucket, count(*) as n
  from (
    select to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM') as month,
           e.kind,
           case
             when e.kind = 'ad_impression' then
               case when e.path = '/' then 'Homepage' when e.path like '/%' then 'Other pages' end
             else e.kind
           end as bucket
    from analytics_events e
    where e.occurred_at >= p_since
      and (
        (e.kind = 'ad_impression' and e.advert_id in (select a.id from adverts a where a.member_id = p_member))
        or (e.kind in ('ad_click', 'outbound_click', 'phone_click', 'email_click', 'social_click') and e.member_id = p_member)
      )
  ) events
  where bucket is not null
  group by month, kind, bucket;
$$;

revoke execute on function member_event_months(uuid, timestamptz) from public, anon, authenticated;
grant execute on function member_event_months(uuid, timestamptz) to service_role;
