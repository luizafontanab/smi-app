-- Consent evidence on contacts (gap review area 6, Jas's SOP "Compliance":
-- "the opt-in source and date on every CRM contact"; GDPR.md G9 / Art 7(1)).
-- Until now a contact carried only `source` and `created_at`, and nothing said
-- what the person saw when they opted in, so consent couldn't be shown.
--
-- opt_in_at      — when the contact was put on the list, by whatever route.
-- opt_in_source  — the route: 'site_form' (a signup form on the site),
--                  'console' (an admin added or re-opted them in), 'bigin'
--                  (imported from Bigin by a pull).
-- opt_in_wording — the copy shown at a site_form signup, as lib/newsletter-consent
--                  renders it. NULL for console and bigin opt-ins: nobody was
--                  shown anything we could record.
--
-- Set by the app on every opt-in path (lib/newsletter-consent.ts optInEvidence);
-- never cleared by an unsubscribe, which has its own unsubscribed_at.
--
-- Backfill (Luiza, 21 Oct): rows imported from Bigin that are still on the
-- list get their import date (created_at) as opt_in_at, with source 'bigin'
-- and no wording. That date is when *we* got the contact, not when they
-- consented — opt_in_source 'bigin' always means "date of import, no consent
-- record", and GAPS says so. Site signups and console rows are left empty: we
-- can't tell which form or wording they saw, and an empty field is honest.
-- Idempotent: only rows still without opt_in_at are touched.
--
-- RLS is unchanged (enabled, no policies — service role only).

alter table contacts
  add column if not exists opt_in_at timestamptz,
  add column if not exists opt_in_source text,
  add column if not exists opt_in_wording text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_opt_in_source_check') then
    alter table contacts
      add constraint contacts_opt_in_source_check
      check (opt_in_source is null or opt_in_source in ('site_form', 'console', 'bigin'));
  end if;
end $$;

update contacts
   set opt_in_at = created_at,
       opt_in_source = 'bigin'
 where source = 'bigin'
   and opt_in_at is null
   and subscribed
   and unsubscribed_at is null;
