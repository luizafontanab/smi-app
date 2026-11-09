-- The nightly rollup now makes sure this month's analytics partition exists,
-- not only next month's.
--
-- analytics_events is partitioned by month, and a row for a month with no
-- partition is rejected ("no partition of relation analytics_events found for
-- row", SQLSTATE 23514). Partitions were only ever created one month ahead by
-- run_daily_rollup(), so a month the rollup didn't run before was never
-- created afterwards either: every later run made the *following* month and
-- skipped the missing one. Staging hit exactly this. Its cron never ran until
-- the GitHub Action of 9 Nov 2026 (#94), so November 2026 had no partition and
-- every page view, story view and ad event from 1 Nov on was dropped, logged
-- as analytics:events-insert on /console/errors.
--
-- Body otherwise unchanged from 20260901000010. `create or replace` keeps the
-- existing grants (service_role only, 20260816000002); the revoke below is
-- repeated so the migration-hygiene test sees it and so this file is safe on
-- its own.
--
-- Idempotent: ensure_analytics_partition() does nothing for a month that
-- already exists.

create or replace function run_daily_rollup() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform ensure_analytics_partition(now()::date);
  perform ensure_analytics_partition((now() + interval '1 month')::date);

  insert into rollups_daily (day, kind, story_id, member_id, advert_id, count)
  select occurred_at::date, kind, story_id, member_id, advert_id, count(*)
  from analytics_events
  where occurred_at >= (current_date - 1)
  group by 1, 2, 3, 4, 5
  on conflict (day, kind,
    coalesce(story_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(advert_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set count = excluded.count;

  insert into engagement_audit (member_id, occurred_on, region, company, page, views)
  select member_id, occurred_at::date, region, company, 'member page', count(*)
  from analytics_events
  where kind = 'member_page_view' and member_id is not null
    and occurred_at >= (current_date - 1)
  group by 1, 2, 3, 4
  on conflict (member_id, occurred_on, coalesce(region, ''), coalesce(company, ''), page)
  do update set views = excluded.views;
end $$;

revoke execute on function run_daily_rollup() from public;
grant execute on function run_daily_rollup() to service_role;

-- Repair now rather than at the next rollup: events are being dropped until
-- this month's partition exists.
select ensure_analytics_partition(now()::date);
select ensure_analytics_partition((now() + interval '1 month')::date);
