-- CRM companies: a JSON copy of every Bigin field (issue #54, spec #49,
-- ADR 0002).
--
-- The company sync now reads Bigin's Companies field list
-- (settings/fields?module=Accounts) and asks for every field, custom ones
-- included. The record comes back as one JSON object, stored here as Bigin
-- sent it, for the CRM Companies box's detail view. The labels to show it
-- with are kept beside the run in `settings` (crm_company_fields).
--
-- '{}' until a sync fills it. When the field list can't be read (the Bigin
-- token lacks the field-list scope), the sync leaves a stored copy alone
-- rather than shrinking it to the three known fields.
--
-- Additive and idempotent. RLS is already on for crm_companies (no policies).

alter table crm_companies add column if not exists fields jsonb not null default '{}'::jsonb;
