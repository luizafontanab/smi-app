-- Nightly rollup: aggregate yesterday+today's events into rollups_daily and
-- refresh the member-facing engagement audit. Also keeps partitions ahead.

-- dedupe target for audit refresh re-runs
create unique index if not exists engagement_audit_key on engagement_audit (
  member_id, occurred_on, coalesce(region, ''), coalesce(company, ''), page
);

create or replace function run_daily_rollup() returns void
language plpgsql security definer set search_path = public as $$
begin
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
    and (region is not null or company is not null)
  group by 1, 2, 3, 4
  on conflict (member_id, occurred_on, coalesce(region, ''), coalesce(company, ''), page)
  do update set views = excluded.views;
end $$;

grant execute on function run_daily_rollup() to service_role;
