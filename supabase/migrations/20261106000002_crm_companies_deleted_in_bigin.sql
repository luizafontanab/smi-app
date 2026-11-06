-- CRM companies deleted in Bigin (issue #52, spec #49, ADR 0002).
--
-- A company that disappears from a *complete* Bigin read is kept here, not
-- removed: nothing is deleted on either side, the same rule as contacts.
-- deleted_in_bigin_at is when the company sync first found it missing. The
-- CRM Companies box hides these rows by default and shows them under a
-- "Deleted in Bigin" filter. A company that comes back in a later read has
-- the mark cleared (src/lib/crm-companies/sync.ts). A partial read never sets
-- it.
--
-- Its story source is handled by the existing source rules, which already
-- unlink a company missing from a complete read and pause the source only
-- if it was bigin_only — no schema change needed there.
--
-- Additive and idempotent. crm_companies already has RLS on with no
-- policies (20261106000001); nothing to change there.

alter table crm_companies add column if not exists deleted_in_bigin_at timestamptz;

-- The box's default view is "not deleted"; keep that filter cheap.
create index if not exists crm_companies_deleted_in_bigin_idx on crm_companies (deleted_in_bigin_at) where deleted_in_bigin_at is not null;
