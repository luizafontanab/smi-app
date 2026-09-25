-- The story↔member graph, plus the one member field the import was dropping
-- that is actually populated.
--
-- 1. story_members
--
-- Legacy tags a news article to member companies through two ACF fields.
-- `tag_a_member` is a single-select (43 published posts use it) and was the
-- only one the importer read. `link_a_member` is a *multi*-select whose value
-- is a PHP-serialized array, and the importer parsed it with Number(), which is
-- NaN for a serialized string — so it contributed nothing at all. Between them
-- they carry 623 links across 82 members; 485 stories have at least one and 90
-- have between 2 and 13.
--
-- stories.member_id is a single FK and stays as the *primary* member (the one
-- the story leads with, preferred from `tag_a_member`). It physically cannot
-- hold the other 138 links, hence this table. Shape and policy copied from
-- member_services (20260909000001).
--
-- 2. members.brand_hex
--
-- 111 of the 123 exported members carry a brand colour (e.g. "#0089cf") that
-- had no target column, so the import dropped it. Nothing reads it yet; this
-- just stops the cutover import losing it.
--
-- Deliberately NOT added, having checked the export rather than the meta-row
-- counts: `registration_number` and `year_established`. The "132 members" both
-- appeared to have is the number of meta rows *present*; filtering out empty
-- strings leaves 3 and 4 real values respectively, and one of the three
-- registration numbers is a company name typed into the wrong field. Two
-- columns for seven values, one of them junk, is not worth the schema — the
-- data stays in the extract if it is ever wanted.
--
-- Also not included: the two legacy Sector terms with no membership type
-- ("Subcontractor/OEM", "Trade Association/Events"). Adding those rows changes
-- a product-facing vocabulary Jas defined, so it is an ask-jas item, not a
-- migration.

create table story_members (
  story_id uuid not null references stories(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  primary key (story_id, member_id)
);
create index story_members_member_idx on story_members (member_id);

alter table story_members enable row level security;
-- Published stories are public and so is the directory, so the pairing is too:
-- the join reveals nothing that is not already on both pages.
create policy public_read_story_members on story_members for select using (true);

-- All 111 exported values are #RRGGBB; the check keeps a malformed one from
-- ever reaching a style attribute.
alter table members add column brand_hex text;
alter table members add constraint members_brand_hex_check
  check (brand_hex is null or brand_hex ~ '^#[0-9a-fA-F]{6}$');
