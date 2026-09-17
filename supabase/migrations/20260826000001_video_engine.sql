-- Video Engine: bring `videos` to parity with `stories`' workflow columns so it
-- can drive the same board/calendar/approve/schedule/pin console UI, plus
-- member self-submission.

alter table videos
  add column scheduled_at timestamptz,
  add column pinned_until timestamptz,
  add column submitted_by uuid references profiles(user_id),
  add column rejected_reason text,
  add column updated_at timestamptz not null default now();

-- additive: keeps existing 'manual'/'curated' seed values, adds 'member' for
-- self-submission (mirrors stories' admin/member/import).
alter table videos drop constraint if exists videos_source_check;
alter table videos add constraint videos_source_check
  check (source in ('manual', 'curated', 'member'));

alter table approvals drop constraint if exists approvals_kind_check;
alter table approvals add constraint approvals_kind_check
  check (kind in ('story', 'event', 'member_revision', 'member_activation', 'machine', 'video'));

create index videos_status_published_idx on videos (status, published_at desc);
create index videos_member_idx on videos (member_id) where member_id is not null;

-- member self-service RLS, mirroring member_read_own_stories / member_insert_story
create policy member_read_own_videos on videos for select
  using (member_id = current_member_id());
create policy member_insert_video on videos for insert
  with check (member_id = current_member_id() and source = 'member'
              and status = 'awaiting_approval');
