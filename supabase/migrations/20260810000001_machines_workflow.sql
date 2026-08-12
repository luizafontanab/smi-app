-- Member equipment submissions (user decision 2026-08-09): featured_machines
-- gains the same approval workflow as stories. Existing rows are admin-seeded
-- and stay live via the 'published' default.
alter table featured_machines
  add column status text not null default 'published'
    check (status in ('draft', 'awaiting_approval', 'published', 'rejected')),
  add column source text not null default 'admin' check (source in ('admin', 'member')),
  add column submitted_by uuid references profiles(user_id),
  add column rejected_reason text;

create index featured_machines_status_idx on featured_machines (status);

alter table approvals drop constraint if exists approvals_kind_check;
alter table approvals add constraint approvals_kind_check
  check (kind in ('story', 'event', 'member_revision', 'member_activation', 'machine'));
