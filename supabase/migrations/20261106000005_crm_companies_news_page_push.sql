-- CRM companies: News Page URL edits written through to Bigin (issue #55,
-- spec #49, ADR 0002).
--
-- An admin can now edit a CRM company's News Page URL in CRM's Companies box.
-- The edit is saved here first (crm_companies.news_page_url) and then pushed
-- to Bigin, the same way a contact edit is (contacts.crm_dirty_at):
--
--   news_page_pending_at — set when the edit is saved, cleared once Bigin
--   accepts it. While it is set the edit "hasn't reached Bigin yet": the
--   company sync keeps the local News Page URL instead of Bigin's (stale)
--   copy, and derives the company's story source from the local value. A
--   failed push leaves it set; the crm_push retry and the crm_sync sweep
--   push it again (src/lib/crm-companies/news-page.ts).
--
-- Additive and idempotent. crm_companies already has RLS on with no
-- policies (20261106000001) — console-managed, service role only.

alter table crm_companies add column if not exists news_page_pending_at timestamptz;

-- The retry sweep looks for pending pushes; there are only ever a handful.
create index if not exists crm_companies_news_page_pending_idx
  on crm_companies (news_page_pending_at) where news_page_pending_at is not null;
