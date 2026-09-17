-- Member self-service edit/withdraw before approval (GAPS A4.17): a pending
-- submission can now be pulled back rather than only ever waiting on a
-- decision. 'withdrawn' keeps the row (unlike a delete) so console history
-- and any linked rows (e.g. story_categories) stay intact.
alter type content_status add value 'withdrawn';

alter table featured_machines drop constraint featured_machines_status_check;
alter table featured_machines add constraint featured_machines_status_check
  check (status in ('draft', 'awaiting_approval', 'published', 'rejected', 'withdrawn'));
