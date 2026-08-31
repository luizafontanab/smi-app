-- Bundle-account label (A2.3): a fulfilment tag only — "does someone need to
-- chase this client's six formats of artwork" — with no relationship to the
-- `bundles` table, which prices a deal, not a client. A bundle account can be
-- tagged before any `bundles` row is priced, or kept tagged between renewal
-- cycles when no `bundles` row is currently live; deriving the flag from
-- "has a bundles row" would couple two things that don't need to move
-- together, for no benefit.
--
-- NEUTRALITY: this column may never be read by src/lib/adverts.ts or passed
-- into dealSlots()/uniformShuffle(). It is a display/filter field only.
-- Enforced by an automated source-grep test in tests/unit/adverts.test.ts,
-- not just this comment — RLS cannot help here, since liveBookings() reads
-- through serviceDb() (service-role, RLS-bypassing) like the rest of the app.

alter table members add column is_bundle_account boolean not null default false;

notify pgrst, 'reload schema';
