-- Bounced kept apart from unsubscribed, and Mailchimp as an opt-in route
-- (gap review area 7, Jas's SOP Step 4; Luiza's decisions 21 Oct in the
-- area-7 plan; GAPS B5.12 and B5.13).
--
-- bounced_at — a hard bounce: the address doesn't take mail. Until now the
-- Resend webhook treated one as a permanent unsubscribe, which stamped
-- unsubscribed_at (never cleared by sync) and pushed Email_Opt_Out=true to
-- Bigin, so a contact whose address was later fixed stayed off the list until
-- an admin ticked "re-opt-in" — and Bigin recorded an opt-out the person never
-- made. The SOP keeps "Bounced" as its own status for the same reason.
--   · A bounced contact is never mailed (lib/adapters/newsletter.ts
--     subscribedContacts, and the console's audience counts).
--   · It is not an opt-out: nothing about it is pushed to Bigin, and
--     subscribed / unsubscribed_at are untouched.
--   · Cleared when the email address changes (console edit or Bigin pull) or
--     when an admin ticks "address fixed" on /console/crm.
-- Spam complaints and a Resend-side contact.deleted stay permanent
-- unsubscribes (Luiza, 21 Oct).
--
-- No backfill: contacts already unsubscribed by a hard bounce can't be told
-- apart from real unsubscribes (the reason was only ever logged), so they stay
-- unsubscribed. No real sends have gone out, so there should be none.
--
-- opt_in_source gains 'mailchimp', for contacts brought in or evidenced by
-- `pnpm contacts:import-mailchimp` from the agency's Mailchimp export: the
-- date is Mailchimp's own opt-in (or confirm) time. Recreated rather than
-- edited — 20261021000004 may already be applied.
--
-- RLS is unchanged (enabled, no policies — service role only).

alter table contacts
  add column if not exists bounced_at timestamptz;

alter table contacts drop constraint if exists contacts_opt_in_source_check;
alter table contacts
  add constraint contacts_opt_in_source_check
  check (opt_in_source is null or opt_in_source in ('site_form', 'console', 'bigin', 'mailchimp'));
