-- notify_member (lib/jobs.ts) used to insert a notifications row, send the
-- email, then stamp emailed_at as three separate steps. A crash between the
-- send and the stamp meant a retry couldn't tell "already sent" from "never
-- tried" — it just inserted a second row and sent the email again. This
-- column lets the job find its own prior attempt instead of guessing.
alter table notifications add column if not exists job_id uuid references jobs(id) on delete set null;

-- One notification per job, at most. Partial so historical/legacy rows and
-- jobs of kinds other than notify_member (which never set job_id) are unaffected.
create unique index if not exists notifications_job_id_key on notifications(job_id) where job_id is not null;

notify pgrst, 'reload schema';
