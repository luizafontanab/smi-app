-- The member ↔ taxonomy join tables are readable only for members the public
-- can see (review finding, 16 Oct).
--
-- member_industries (20261012000001), member_services (20260909000001) and
-- member_membership_types (20260904000001) were all created with
-- `for select using (true)`. members itself is not public:
-- public_read_active_members (20260923000002) shows anon only active/grace
-- members that are not archived. So anon could list the industry, service and
-- membership-type links of every draft, lapsed and archived member — which
-- also enumerates their member ids — straight from PostgREST, for members the
-- site deliberately hides.
--
-- Each policy now asks whether the linked member is visible, through an
-- `exists` on members that runs under the caller's own members RLS — the same
-- shape 20261015000003 gave story_members. It mirrors the members predicate by
-- construction rather than by copy (status in ('active','grace') and
-- archived_at is null, today), so the two cannot drift when that one changes.
--
-- Public reads that embed or scan these tables, checked before changing them:
--   · memberBySlug (queries.ts): embeds member_services and
--     member_membership_types on a members row anon can already see — those
--     links are still visible. The includeArchived (admin) path is serviceDb,
--     which bypasses RLS.
--   · members_in_taxonomies (20261016000040), which the directory filters now
--     go through: security invoker, so it already reads `members` under the
--     caller's RLS and only ever returns visible members; the join-table rows
--     it can no longer see belong to members it could not return anyway.
--   · memberFacets (queries.ts): scans the join tables and then keeps only
--     active members, so the links that disappear are ones it already threw
--     away (its own comment: "Links to members outside the visible set … drop
--     out").
--   · search_members (20261012000001): security invoker, joins
--     member_services and member_industries under the caller's RLS but only
--     for `m.status = 'active'` rows — unchanged results.
-- Console, dashboard and both seeds read and write with the service role.
--
-- Writes are unaffected: none of the three tables has a write policy, and that
-- stays so (service role only).

drop policy if exists public_read_member_industries on member_industries;
create policy public_read_member_industries on member_industries for select
  using (exists (select 1 from members m where m.id = member_industries.member_id));

drop policy if exists public_read_member_services on member_services;
create policy public_read_member_services on member_services for select
  using (exists (select 1 from members m where m.id = member_services.member_id));

drop policy if exists public_read_member_membership_types on member_membership_types;
create policy public_read_member_membership_types on member_membership_types for select
  using (exists (select 1 from members m where m.id = member_membership_types.member_id));
