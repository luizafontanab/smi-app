-- Gap review area 4 (Jas's Monthly Newsletter SOP, 16 Oct, Steps 2–3):
-- proof, test send and "Approved to send" before an issue can go out.
--
-- Until now any draft could be sent or scheduled straight from the board, with
-- no proof step and no record of who signed it off. The SOP says no issue sends
-- until the proof checklist is fully ticked and the publisher has recorded
-- "Approved to send" with name and date, after a test send.
--
-- Approval is a set of columns, not a new status: it is orthogonal to
-- draft/scheduled/sent/send_failed (an approved issue can be a draft, then
-- scheduled, then failed and retried, and stay approved throughout). Any edit to
-- the content clears it, along with the test-send stamp; the ticks stay, since
-- the SOP's second proof round re-checks only what changed.
--
-- Who did what is recorded, never enforced: the SOP wants the proofreader not
-- to be the builder, but Jas works alone (Luiza, 20 Oct).
--
-- Not audit_events: that log is limited to security by purpose (lib/audit.ts).

alter table newsletter_issues
  add column if not exists created_by uuid references profiles(user_id) on delete set null,
  add column if not exists last_edited_by uuid references profiles(user_id) on delete set null,
  add column if not exists last_edited_at timestamptz,
  -- checklist key (lib/newsletter-proof.ts) → true
  add column if not exists proof_checks jsonb not null default '{}'::jsonb,
  add column if not exists last_test_sent_at timestamptz,
  add column if not exists last_test_sent_by uuid references profiles(user_id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references profiles(user_id) on delete set null,
  -- the subscribed count when it was approved: the SOP's "final audience count recorded"
  add column if not exists approved_recipients int;

-- An issue already queued before this gate existed stays sendable: the send job
-- now refuses unapproved issues, and these were scheduled under the old rules.
-- approved_by stays null, which the console shows as "before approval existed".
update newsletter_issues
set approved_at = coalesce(scheduled_at, now())
where status = 'scheduled' and approved_at is null;
