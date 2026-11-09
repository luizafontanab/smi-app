-- CRM companies: the admin's member override (issue #53, spec #49, ADR 0002).
--
-- A Bigin-linked story source is matched to one member automatically
-- (lib/sources/bigin.ts matchMembers: a contact linked to both the company
-- and a member, else the website domain, nobody when ambiguous). When that
-- match is wrong or ambiguous, every "Start story" draft from the company's
-- suggestions arrives mis-tagged or untagged, and nothing in the console
-- could fix it. An admin can now choose the member by hand in CRM's
-- Companies box; the choice wins over the automatic match for the company's
-- sources on every sync.
--
-- Kept in the app only: Bigin has no member field, and the company sync
-- never writes this column, so the choice survives every sync. Company rows
-- are never deleted (a company deleted in Bigin is only marked, #52), so it
-- survives deletion and return too. A deleted member clears the choice
-- (on delete set null), and the company falls back to the automatic match.
--
-- Additive and idempotent. crm_companies already has RLS on with no
-- policies (console-only, 20261106000001); nothing to add.

alter table crm_companies add column if not exists member_override_id uuid references members(id) on delete set null;

create index if not exists crm_companies_member_override_idx on crm_companies (member_override_id) where member_override_id is not null;
