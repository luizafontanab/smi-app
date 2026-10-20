-- Security audit log (docs/GDPR.md §16 "A", gap G4).
--
-- Who did what to an account or a member record: sign-ins (and failed ones),
-- sign-outs, password and login-email changes, an admin viewing as a member
-- (fix-list 94), and the console's member actions (create, edit, status,
-- payment, archive, delete). Nothing recorded who looked at or changed member
-- data before this; the ICO's audit toolkit expects exactly that record.
--
-- Append-only from the app, on purpose. The ICO toolkit: "Protect logs by
-- making sure staff with privileged access rights do not have permission to
-- delete or de-activate their own activities." Every app client — the console
-- included — runs as service_role, so service_role keeps INSERT and SELECT
-- only. The one path that removes or changes rows is purge_audit_events()
-- below, run by the daily log_retention job.
--
-- Retention (proposed in docs/GDPR.md §17, awaiting Jas's sign-off; this log
-- is new, so nothing existing is lost meanwhile): rows 12 months, IP
-- addresses and attempted-login emails 90 days.
--
-- No foreign keys: the record of who deleted a member, or what a since-deleted
-- login did, must outlive the rows it is about.
create table audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  actor_user_id uuid,
  actor_role text check (actor_role in ('admin', 'member')),
  member_id uuid,
  -- Small, minimised context: a status moved from/to, a member name kept for
  -- after deletion. Never page content or anything a log doesn't need.
  detail jsonb not null default '{}'::jsonb,
  -- Security events only (sign-in, failed sign-in, credential changes).
  ip inet
);

create index audit_events_member_idx on audit_events (member_id, at desc) where member_id is not null;
create index audit_events_actor_idx on audit_events (actor_user_id, at desc) where actor_user_id is not null;
create index audit_events_at_idx on audit_events (at);

alter table audit_events enable row level security;
-- no policies: written and read only through the service role, server-side.

revoke all on audit_events from anon, authenticated;
revoke update, delete, truncate on audit_events from service_role;

-- Retention, as the table owner: the only way a row is ever changed or removed.
create or replace function purge_audit_events()
returns void
language sql
security definer
set search_path = public
as $$
  delete from audit_events where at < now() - interval '12 months';
  update audit_events
     set ip = null, detail = detail - 'email'
   where at < now() - interval '90 days'
     and (ip is not null or detail ? 'email');
$$;

revoke execute on function purge_audit_events() from public;
grant execute on function purge_audit_events() to service_role;
