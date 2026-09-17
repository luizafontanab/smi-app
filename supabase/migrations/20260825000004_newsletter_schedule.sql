-- Newsletter Board + Calendar (mirrors the Story Engine's board/calendar):
-- issues need a future-dated "scheduled" state to have anything to plot on a
-- calendar or hold in a middle board column. Sending itself still goes through
-- the existing newsletter_send job (src/lib/jobs.ts) — scheduleIssue just
-- enqueues it with a future due_at instead of "now".
alter table newsletter_issues add column scheduled_at timestamptz;

alter table newsletter_issues drop constraint if exists newsletter_issues_status_check;
alter table newsletter_issues add constraint newsletter_issues_status_check
  check (status in ('draft', 'scheduled', 'sent'));
