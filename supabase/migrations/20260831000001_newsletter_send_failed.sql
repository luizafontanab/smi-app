-- GAPS C3 — newsletter issues were marked 'sent' whether or not anything was
-- sent: the newsletter_send job flipped the status unconditionally on top of a
-- logging stub, so the console told Jas an issue had gone out to the list when
-- nothing had left the building.
--
-- Sending is now conditional on the sender reporting success, which needs a
-- state for the failure. 'send_failed' is terminal-ish and retryable: the issue
-- keeps its content and can be re-sent once the cause is fixed, and it surfaces
-- in "Needs You Today" rather than sitting silently in the sent pile.
alter table newsletter_issues drop constraint if exists newsletter_issues_status_check;
alter table newsletter_issues add constraint newsletter_issues_status_check
  check (status in ('draft', 'scheduled', 'sent', 'send_failed'));

-- Why the last attempt failed, for the console to show. Cleared on a retry.
alter table newsletter_issues add column if not exists send_error text;
