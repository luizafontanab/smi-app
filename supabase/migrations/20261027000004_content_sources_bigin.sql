-- Story sources from Bigin (Luiza, 27 Oct 2026). Bigin Companies now carry a
-- "News Page URL" field; it becomes a second, live source list for the story
-- crawler alongside the imported spreadsheet (20261020000002_content_sources).
-- A daily sync (src/lib/sources/bigin.ts) reads every company's URL and links
-- it to a content_sources row — the existing row when the spreadsheet already
-- has that page, a new one otherwise.
--
-- bigin_only marks rows the sync created. When a company's URL is changed or
-- cleared in Bigin, its old row loses the Bigin link, and is paused only if it
-- was bigin_only: a page that is also on the spreadsheet (or was added by hand
-- in the console) keeps running. Existing rows default to false for that reason.
--
-- member_id is the member the company matches (by Bigin company id on a linked
-- contact, else by website domain), so "Start story" on a suggestion opens a
-- draft already tagged with them. on delete set null: deleting a member must
-- not delete the source.
--
-- Additive and idempotent. RLS unchanged: content_sources has RLS with no
-- policies (service role only).
alter table content_sources add column if not exists bigin_account_id text;
alter table content_sources add column if not exists bigin_account_name text;
alter table content_sources add column if not exists bigin_only boolean not null default false;
alter table content_sources add column if not exists member_id uuid references members(id) on delete set null;

-- One source per Bigin company.
create unique index if not exists content_sources_bigin_account_idx
  on content_sources (bigin_account_id) where bigin_account_id is not null;
