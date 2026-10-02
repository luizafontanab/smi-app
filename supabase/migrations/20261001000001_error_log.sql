-- Error log: grouped, alertable, developer-only (logging plan, Phase 1).
--
-- Until now nothing recorded a failure. Error pages showed a digest, the
-- `[supabase]` transport logger printed one line, jobs kept one String(e) in
-- jobs.last_error, and everything else was a console line in Vercel's
-- ungrouped, unalerted function logs. Decided 29–30 Sep (Luiza): our own
-- tables rather than a vendor, 90-day retention, alerts to the developer, and
-- never visible in Jas's console — read on a developer-only page gated by an
-- email allowlist (src/lib/developer.ts).
--
-- One row per distinct error (`error_events`, grouped by a fingerprint the app
-- computes — see src/lib/log.ts) plus a bounded sample of occurrences. Writes
-- go through log_error_event() so a burst of the same failure counts
-- atomically instead of racing a select-then-update, the same reason
-- bump_consent_stats (20260901000011) exists.

create table if not exists error_events (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source text not null check (source in ('server', 'client', 'job', 'webhook', 'adapter', 'db')),
  area text not null,
  message text not null,
  stack text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  count bigint not null default 1,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  alerted_at timestamptz,
  resolved_at timestamptz
);
create index if not exists error_events_status_seen_idx on error_events (status, last_seen desc);

create table if not exists error_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references error_events (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  path text,
  digest text,
  user_id uuid,
  context jsonb not null default '{}'::jsonb
);
create index if not exists error_occurrences_event_idx on error_occurrences (event_id, occurred_at desc);

alter table error_events enable row level security;
alter table error_occurrences enable row level security;
-- no policies: developer log, service role only. Never readable through the
-- publishable key, and never surfaced in the admin console.

-- Record one occurrence. A resolved error that happens again reopens (and so
-- alerts again); an ignored one stays ignored. Occurrences are capped at the
-- newest 50 per error so a hot loop can't fill the table.
create or replace function log_error_event(
  p_fingerprint text,
  p_source text,
  p_area text,
  p_message text,
  p_stack text,
  p_path text,
  p_digest text,
  p_user uuid,
  p_context jsonb
) returns table (event_id uuid, is_new boolean, reopened boolean, alerted_at timestamptz, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_new boolean;
  v_prev_status text;
  v_alerted timestamptz;
  v_status text;
begin
  select e.id, e.status into v_id, v_prev_status from error_events e where e.fingerprint = p_fingerprint;

  insert into error_events as e (fingerprint, source, area, message, stack)
  values (p_fingerprint, p_source, p_area, p_message, p_stack)
  on conflict (fingerprint) do update set
    count = e.count + 1,
    last_seen = now(),
    message = excluded.message,
    stack = coalesce(excluded.stack, e.stack),
    status = case when e.status = 'resolved' then 'open' else e.status end,
    resolved_at = case when e.status = 'resolved' then null else e.resolved_at end
  returning e.id, e.alerted_at, e.status into v_id, v_alerted, v_status;

  v_new := v_prev_status is null;

  insert into error_occurrences (event_id, path, digest, user_id, context)
  values (v_id, p_path, p_digest, p_user, coalesce(p_context, '{}'::jsonb));

  delete from error_occurrences o
  where o.event_id = v_id
    and o.id not in (
      select o2.id from error_occurrences o2 where o2.event_id = v_id order by o2.occurred_at desc limit 50
    );

  return query select v_id, v_new, coalesce(v_prev_status = 'resolved', false), v_alerted, v_status;
end $$;

revoke execute on function log_error_event(text, text, text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function log_error_event(text, text, text, text, text, text, text, uuid, jsonb) to service_role;
