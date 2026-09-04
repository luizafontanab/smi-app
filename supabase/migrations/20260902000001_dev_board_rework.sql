-- Rework the dev board to match how the team actually works now that the
-- build is in its testing phase: "in_progress" was too coarse (a card being
-- coded and a card being tested are different conversations), and "blocked"
-- earned a whole column for what is really a note on a card.
--
--   before: not_started | in_progress | blocked | in_staging | done
--   after:  not_started | coding | testing | in_staging | done
--
-- canceled stays as the list-view-only state it already was. The assignee
-- list also shrinks to the people actually working the board — Harsh and Dan
-- are off it. The TS mirrors of both sets are DEV_STATUSES / DEV_ASSIGNEES
-- in src/lib/dev-tasks.ts, changed in the same commit; the board UI derives
-- everything from those consts.
--
-- Constraints drop first — remapping in_progress -> coding would violate the
-- old check while it still stands. Existing rows are remapped in between
-- (production may hold widget-reported tasks): in_progress was active work,
-- so it lands in coding; blocked work is by definition not progressing, so it
-- returns to not_started — the why lives on in the card's own description/
-- triage notes. Harsh's and Dan's cards go back to unassigned.
alter table dev_tasks drop constraint dev_tasks_status_check;
alter table dev_tasks drop constraint dev_tasks_assignee_check;

update dev_tasks set status = 'coding' where status = 'in_progress';
update dev_tasks set status = 'not_started' where status = 'blocked';
update dev_tasks set assignee = null where assignee in ('Harsh', 'Dan');

alter table dev_tasks add constraint dev_tasks_status_check
  check (status in ('not_started', 'coding', 'testing', 'in_staging', 'done', 'canceled'));
alter table dev_tasks add constraint dev_tasks_assignee_check
  check (assignee in ('Jas', 'Rishi', 'Luiza'));
