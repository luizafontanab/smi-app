-- Internal dev backlog: a floating "Report a bug" button (admin only,
-- every route) writes a row here with the page it came from, the browser
-- environment and any recent client errors already attached; the team also
-- adds and works ordinary tasks straight on the board at /console/dev. One
-- table, two ways in, no separate triage page.
--
-- Not customer data: no RLS policies, service-role only, like page_layouts and
-- the advert tables — load-bearing, because 20260808000006_grants.sql grants
-- anon/authenticated access to every new public table by default privilege.
-- Console access is gated to admin in app code (isAdmin/requireConsole in
-- src/lib/auth.ts), since RLS can't see profiles.role.
--
-- Four text columns, four different authors:
--   description   - what the reporter (widget) or a teammate (board) typed
--   notes         - the widget's auto-captured snapshot, rendered human-readable
--                   at insert so it stays truthful even if the renderer changes
--                   later; '' for tasks that didn't come from the widget
--   triage_notes  - the one editable scratchpad, written back while the team
--                   works a task, whichever way it arrived
--   context       - the same widget snapshot, structured, for querying later
--
-- kind (bug/idea/copy/question) is set by the widget and left null for
-- ordinary board tasks — nullable text+check allows that with no "n/a" sentinel.
--
-- assignee is a closed list of five names, not a profiles FK: none of them
-- necessarily has an account, and a lookup table for five names is overhead.
-- Null = unassigned; widget reports are explicitly assigned to Luiza in
-- application code (submitDevTask), not via a column default.
--
-- No trigger maintains updated_at: this repo has no triggers anywhere, so
-- every UPDATE stamps it in application code.
create table dev_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  notes text not null default '',
  triage_notes text not null default '',
  context jsonb not null default '{}',
  kind text check (kind in ('bug', 'idea', 'copy', 'question')),
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'blocked', 'in_staging', 'done', 'canceled')),
  assignee text check (assignee in ('Jas', 'Rishi', 'Luiza', 'Harsh', 'Dan')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  -- position within a status column; rewritten as a dense 0..n-1 run on every
  -- drop, and also how a newly created or newly reported task is placed (at
  -- the end of its column) — see createDevTask / submitDevTask
  sort_order integer not null default 0,
  -- denormalised out of context->page->pathname; null for board-created tasks
  page_path text,
  created_by uuid references profiles(user_id),
  reporter_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The board's only query shape: order by column, then position within it.
create index dev_tasks_status_order_idx on dev_tasks (status, sort_order);

alter table dev_tasks enable row level security;
