-- Two-way Bigin sync (GAPS B6.4–B6.8). Until now `contacts` was only ever
-- written *to* Bigin, and only partly: opt-outs never left this table, and
-- nothing new or edited in Bigin ever came back. The pull, the webhook and the
-- full-state push in lib/adapters/crm.ts need four more columns.
--
-- bigin_company_id / bigin_company_name — Bigin stores a contact's company as a
--   lookup to a Companies record, not free text. `company` stays as our own
--   label; this pair is the link to an *existing* Bigin company (we never
--   create companies there). The name is kept so the console can show the link
--   without a Bigin round trip.
-- bigin_modified_at — Bigin's Modified_Time as of our last pull of the record.
-- crm_dirty_at — set when a local edit still has to reach Bigin, cleared on a
--   successful push. A pull leaves the profile fields of a dirty row alone, so
--   a queued push isn't overwritten by the stale Bigin copy it is replacing.
--
-- No backfill: every existing row is clean and unlinked, which is the truth.
-- RLS is unchanged (enabled, no policies — service role only).

alter table contacts
  add column if not exists bigin_company_id text,
  add column if not exists bigin_company_name text,
  add column if not exists bigin_modified_at timestamptz,
  add column if not exists crm_dirty_at timestamptz;

-- the retry sweep in CrmSync.sync() reads only the dirty rows
create index if not exists contacts_crm_dirty_idx on contacts (crm_dirty_at) where crm_dirty_at is not null;
