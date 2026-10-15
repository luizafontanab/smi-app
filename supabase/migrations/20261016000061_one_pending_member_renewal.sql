-- One pending member renewal per run (16 Oct code review).
--
-- renewAdvertBooking (src/app/dashboard/actions.ts) inserts a fresh
-- awaiting_approval booking with renewed_from = the run being renewed. The
-- overlap exclusion constraint (advert_bookings_no_overlap, last re-created in
-- 20261006000002) only covers awaiting_payment / scheduled / live, so a
-- double-submitted renewal form wrote two identical requests, each with its own
-- console notification, and approving both would then collide on the overlap
-- constraint with no clue why.
--
-- Scoped to the member's own requests while they wait for a decision: the
-- console's renewBooking starts its renewals as 'draft' (source 'admin'), and a
-- request that has been decided — approved, sent back, ended — no longer blocks
-- asking again. The action maps a violation to "already asked" rather than an
-- error.
--
-- Pre-check: fails if two pending member renewals of one run already exist —
--   select renewed_from, count(*) from advert_bookings
--   where renewed_from is not null and status = 'awaiting_approval' and source = 'member'
--   group by 1 having count(*) > 1;
-- withdraw or decide the extra one first.

create unique index if not exists advert_bookings_one_pending_member_renewal
  on advert_bookings (renewed_from)
  where renewed_from is not null and status = 'awaiting_approval' and source = 'member';
