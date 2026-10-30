-- Console analytics rebuild (29 Oct 2026): Jas reads site stats in a Data
-- Studio report from the old site (top pages, user sources by site, device
-- split, total/new users, sessions per user, each against the previous
-- period, plus a country view). The console page now reproduces that from
-- our own first-party events, so two things have to start being recorded:
--
--   device  - desktop / mobile / tablet, derived from the user-agent at
--             request time (src/lib/analytics.ts deviceFromUserAgent). The
--             user-agent itself is still never stored.
--   country - ISO 3166 alpha-2 from Vercel's x-vercel-ip-country header.
--             Deliberately a new column, not `region`: region feeds
--             engagement_audit and members' /dashboard/stats and is reserved
--             for the GeoLite2 lookup (GAPS B2.1).
--
-- Both are filled only for consented visitors, like every other identifier.
-- Rows before this migration have neither, so the console shows them as
-- "unknown". No index is added: an index on this partitioned table locks
-- every partition while it builds (docs/HUMAN-TODO.md).

alter table analytics_events
  add column if not exists device text,
  add column if not exists country text;

-- One call returns every figure the console analytics page needs for a
-- [p_from, p_to) window. Exact over raw events, not sampled. Traffic kinds are
-- page_view / story_view / member_page_view: video pages record a page_view
-- as well as a video_view, so counting video_view too would double-count.
--
-- users     distinct session_hash (IP + browser, so one person on two devices
--           counts twice -- same definition as site_sessions_last_year)
-- new_users users whose hash has no traffic event before p_from. That check
--           scans earlier partitions without a session_hash index; fine at
--           current volume (hundreds of rows a day), revisit if it gets slow.
-- sessions  runs of events per user split by gaps of 30 minutes or more.
-- sources   each user's first event in the window, by referrer host
--           ("www." stripped). No referrer, or a referrer on p_site_host
--           itself, counts as "(direct)".
create or replace function site_stats(p_from timestamptz, p_to timestamptz, p_site_host text default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with ev as (
    select occurred_at, path, session_hash, referrer, device, country
    from analytics_events
    where kind in ('page_view', 'story_view', 'member_page_view')
      and occurred_at >= p_from
      and occurred_at < p_to
  ),
  gaps as (
    select session_hash,
           occurred_at - lag(occurred_at) over (partition by session_hash order by occurred_at) as gap
    from ev
    where session_hash is not null
  ),
  firsts as (
    select distinct on (session_hash) session_hash, referrer
    from ev
    where session_hash is not null
    order by session_hash, occurred_at
  ),
  hosts as (
    select session_hash,
           regexp_replace(lower(substring(referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)')), '^www\.', '') as host
    from firsts
  ),
  sourced as (
    select session_hash,
           case
             when host is null or host = '' then '(direct)'
             when p_site_host is not null and host = regexp_replace(lower(p_site_host), '^www\.', '') then '(direct)'
             else host
           end as source
    from hosts
  )
  select jsonb_build_object(
    'views', (select count(*) from ev),
    'users', (select count(distinct session_hash) from ev),
    'new_users', (
      select count(*) from (select distinct session_hash from ev where session_hash is not null) u
      where not exists (
        select 1 from analytics_events e
        where e.session_hash = u.session_hash
          and e.kind in ('page_view', 'story_view', 'member_page_view')
          and e.occurred_at < p_from
      )
    ),
    'sessions', (select count(*) from gaps where gap is null or gap >= interval '30 minutes'),
    'top_pages', coalesce((
      select jsonb_agg(jsonb_build_object('path', path, 'views', n) order by n desc, path)
      from (select coalesce(path, '(unknown)') as path, count(*) as n from ev group by 1) p
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('source', source, 'users', n) order by n desc, source)
      from (select source, count(*) as n from sourced group by 1) s
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('device', device, 'users', n) order by n desc, device)
      from (
        select coalesce(device, 'unknown') as device, count(distinct session_hash) as n
        from ev where session_hash is not null group by 1
      ) d
    ), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object('country', country, 'users', n) order by n desc, country)
      from (
        select coalesce(country, 'unknown') as country, count(distinct session_hash) as n
        from ev where session_hash is not null group by 1
      ) c
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'views', n) order by day)
      from (select (occurred_at at time zone 'Europe/London')::date as day, count(*) as n from ev group by 1) d
    ), '[]'::jsonb)
  );
$$;

-- Console-only: read through serviceDb() behind requireConsole().
revoke execute on function site_stats(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function site_stats(timestamptz, timestamptz, text) to service_role;
