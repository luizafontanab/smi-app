-- Online payment for advertising (6 Oct, Luiza): an approved, priced run is
-- held until the member pays, through Stripe embedded Checkout.
--
-- Until now an advert invoice was a row that said "issued" for ever: nothing
-- linked it to what it was for, nothing could mark it paid, and the member got
-- an approval email with no way to pay. This adds the three things that were
-- missing:
--
--   1. invoices know what they are for (a booking, a bundle or a placement)
--      and when and how they were paid — so a Stripe payment can release
--      exactly the runs it pays for;
--   2. advert_bookings gain an 'awaiting_payment' status, which the public
--      render predicate (status in scheduled/live) already excludes, and
--      which still reserves its dates in the overlap constraint — a run being
--      paid for must not be double-booked under the member while they pay;
--   3. placements (Featured Member, takeover) get a price and a hold flag,
--      since they have no status column to hold with. The public readers
--      filter on the flag (src/lib/queries.ts).
--
-- An unpaid hold whose term passes is ended by the nightly sweep with the new
-- ended_reason 'unpaid', and its invoice voided (src/lib/jobs.ts).
--
-- Additive and idempotent: re-running changes nothing.

-- 1. invoices
alter table invoices
  add column if not exists description text,
  add column if not exists paid_at timestamptz,
  add column if not exists stripe_session_id text,
  add column if not exists advert_booking_id uuid references advert_bookings(id) on delete set null,
  add column if not exists bundle_id uuid references bundles(id) on delete set null,
  add column if not exists placement_id uuid references placements(id) on delete set null;

-- A Checkout Session settles at most one invoice, and a replayed webhook must
-- find the same row rather than a second one.
create unique index if not exists invoices_stripe_session_idx on invoices (stripe_session_id) where stripe_session_id is not null;
create index if not exists invoices_advert_booking_idx on invoices (advert_booking_id) where advert_booking_id is not null;
create index if not exists invoices_bundle_idx on invoices (bundle_id) where bundle_id is not null;
create index if not exists invoices_placement_idx on invoices (placement_id) where placement_id is not null;

-- 2. advert_bookings
alter table advert_bookings drop constraint if exists advert_bookings_status_check;
alter table advert_bookings add constraint advert_bookings_status_check
  check (status in ('draft', 'awaiting_approval', 'review_required', 'awaiting_payment', 'scheduled', 'live', 'ended'));

alter table advert_bookings drop constraint if exists advert_bookings_ended_reason_check;
alter table advert_bookings add constraint advert_bookings_ended_reason_check
  check (ended_reason in ('term_complete', 'ended_early', 'unpaid'));

-- Same constraint as 20260829000002, widened to held runs. Dropped and
-- recreated rather than altered: an exclusion constraint's predicate can't be.
alter table advert_bookings drop constraint if exists advert_bookings_no_overlap;
alter table advert_bookings add constraint advert_bookings_no_overlap
  exclude using gist (
    advert_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status in ('awaiting_payment', 'scheduled', 'live'));

-- 3. placements
alter table placements
  add column if not exists price_pennies int check (price_pennies >= 0),
  add column if not exists awaiting_payment boolean not null default false;
