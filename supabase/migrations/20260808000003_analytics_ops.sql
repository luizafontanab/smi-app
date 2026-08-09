-- SMI analytics (partitioned events + rollups) and operations (jobs, redirects, inbox, notifications)

create table analytics_events (
  id bigint generated always as identity,
  occurred_at timestamptz not null default now(),
  kind text not null check (kind in ('page_view', 'story_view', 'member_page_view', 'ad_impression', 'ad_click')),
  path text,
  story_id uuid,
  member_id uuid,
  advert_id uuid,
  session_hash text,
  referrer text,
  region text,   -- always attempted (GeoIP)
  company text,  -- optional resolver layer; null when unresolved
  primary key (id, occurred_at)
) partition by range (occurred_at);

-- monthly partitions; the job runner calls this ahead of each month
create or replace function ensure_analytics_partition(p_month date)
returns void language plpgsql as $$
declare
  part_name text := 'analytics_events_' || to_char(p_month, 'YYYY_MM');
  from_ts timestamptz := date_trunc('month', p_month);
  to_ts timestamptz := date_trunc('month', p_month) + interval '1 month';
begin
  if not exists (select 1 from pg_class where relname = part_name) then
    execute format(
      'create table %I partition of analytics_events for values from (%L) to (%L)',
      part_name, from_ts, to_ts
    );
  end if;
end $$;

select ensure_analytics_partition((now() - interval '3 months')::date);
select ensure_analytics_partition((now() - interval '2 months')::date);
select ensure_analytics_partition((now() - interval '1 month')::date);
select ensure_analytics_partition(now()::date);
select ensure_analytics_partition((now() + interval '1 month')::date);

create index analytics_events_kind_idx on analytics_events (kind, occurred_at);
create index analytics_events_member_idx on analytics_events (member_id, occurred_at) where member_id is not null;
create index analytics_events_advert_idx on analytics_events (advert_id, occurred_at) where advert_id is not null;

-- nightly rollups keep dashboards off the raw event tables
create table rollups_daily (
  day date not null,
  kind text not null,
  story_id uuid,
  member_id uuid,
  advert_id uuid,
  count int not null default 0
);
create unique index rollups_daily_key on rollups_daily (
  day, kind,
  coalesce(story_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(advert_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- companies-engaging audit rows surfaced to members ("who's engaging")
create table engagement_audit (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  occurred_on date not null,
  region text,
  company text,
  page text,
  views int not null default 1
);
create index engagement_audit_member_idx on engagement_audit (member_id, occurred_on desc);

-- job queue (Vercel Cron drives it in prod; scripts/job-runner.ts locally).
-- Dead-lettered jobs MUST surface in "Needs You Today" — publishing never silently fails.
create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}',
  due_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_due_idx on jobs (status, due_at);

create table redirects (
  from_path text primary key,
  to_path text not null,
  status_code int not null default 301
);

-- contact + advertising enquiry forms land here (and notify via EmailSender)
create table inbox_messages (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('contact', 'advertising')),
  name text not null,
  email text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table notification_prefs (
  member_id uuid primary key references members(id) on delete cascade,
  stats_frequency text not null default 'quarterly' check (stats_frequency in ('monthly', 'quarterly', 'never')),
  leads_frequency text not null default 'weekly' check (leads_frequency in ('daily', 'weekly', 'never'))
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  kind text not null, -- featured_today | stats_digest | lead_alert | story_live | story_rejected
  payload jsonb not null default '{}',
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

-- audit trail for every approval decision (stories, events, member revisions)
create table approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('story', 'event', 'member_revision')),
  subject_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  reason text,
  decided_by uuid references profiles(user_id),
  decided_at timestamptz not null default now()
);

-- newsletter signups from the public site (flow into contacts + sender via adapter)
create table newsletter_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now()
);
