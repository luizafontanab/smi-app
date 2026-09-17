-- Event Engine: bring `events` to parity with `stories`/`videos`' workflow
-- columns so it can drive the same board/calendar/approve/reject console UI,
-- plus member self-submission. `starts_on`/`ends_on` stay date-only; add an
-- optional time-of-day since events have one and videos/stories don't.

alter table events
  add column starts_time time,
  add column rejected_reason text,
  add column updated_at timestamptz not null default now(),
  add column submitted_by uuid references profiles(user_id),
  add column source text not null default 'admin' check (source in ('admin', 'member'));

create index events_status_starts_idx on events (status, starts_on);

-- member self-service RLS, mirroring member_insert_video
drop policy if exists member_insert_event on events;
create policy member_insert_event on events for insert
  with check (member_id = current_member_id() and source = 'member'
              and status = 'awaiting_approval');
