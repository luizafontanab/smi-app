-- CRM companies: the app's own copy of Bigin's Companies (issue #50, spec #49,
-- ADR 0002).
--
-- Until now the app kept no record of CRM companies, only the story sources
-- Bigin produced (20261027000004, 20261105000001), tagged with the company's
-- Bigin id and name. A company with neither a News Page URL nor a Website was
-- invisible. The company sync (src/lib/crm-companies/sync.ts) now stores
-- every company Bigin returns here first — members and non-members, with or
-- without an address — and then derives story sources exactly as before.
-- The CRM page's Companies box reads this table.
--
-- One row per Bigin company, keyed by its Bigin id. Website and News Page URL
-- are as Bigin last gave them (blank stored as null, so "no address" is a
-- plain `is null` filter). last_synced_at is when the sync last saw the row.
-- Later tickets add the deleted-in-Bigin mark (#52), the member override
-- (#53), the JSON copy of every field (#54) and the News Page URL push state
-- (#55) as further columns.
--
-- Additive and idempotent. Console-only: RLS on with no policies.

create table if not exists crm_companies (
  id uuid primary key default gen_random_uuid(),
  bigin_id text not null unique,
  name text not null default '',
  website text,
  news_page_url text,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_companies_name_idx on crm_companies (lower(name));

alter table crm_companies enable row level security;
-- no policies: console-managed, read and written only through the service role.
