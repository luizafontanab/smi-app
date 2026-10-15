-- A bundle's parts carry no price of their own; the bundle does (review
-- finding on 20261006000001, 16 Oct).
--
-- 20261006000001 moved prices onto bookings and backfilled each one from the
-- rate of the product it had been sold as. Its filter missed bundle parts, so
-- a part whose product had a rate got that rate as its own price, on top of
-- the bundle's — something no write path in the app produces:
-- saveBundleBooking inserts parts unpriced and invoices the bundle once, off
-- bundles.price_pennies, and both seeds price bookings with
-- `.is("bundle_id", null)` for the same reason.
--
-- What a stray part price does today (checked in console/actions.ts and
-- dashboard/actions.ts at 12e339b): nothing invoices an existing part off it,
-- so it is not a double charge yet. But it is shown as the part's price on
-- /console/adverts/[id], prefilled as the price when that run is renewed —
-- renewBooking and renewAdvertBooking both copy price_pennies — and approving
-- a member's renewal invoices whatever the prefilled field holds. That is
-- where it would turn into a charge for a run the bundle already covered.
--
-- So clear it — only on parts with no invoice of their own. A part that was
-- invoiced by itself (saveBooking accepts a bundle_id alongside a price, and
-- raises an invoice for the run) keeps the price it was billed at; the record
-- of what someone paid is not this migration's to rewrite.
--
-- Production: HUMAN-TODO 17.10 removed the invented rate card there on 27 Sep,
-- before 20261006000001 ran, so this should touch no rows unless Jas entered
-- product rates between 27 Sep and 6 Oct. Idempotent.

update advert_bookings b
   set price_pennies = null
 where b.bundle_id is not null
   and b.price_pennies is not null
   and not exists (select 1 from invoices i where i.advert_booking_id = b.id);
