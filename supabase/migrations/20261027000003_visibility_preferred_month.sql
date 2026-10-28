-- The month a member would like a Featured Member slot in, picked on the
-- dashboard's Buy page (27 Oct, Luiza: "can members see which dates are
-- available?" — they couldn't; the request carried only free-text notes).
--
-- preferred_month: the 1st of the chosen month, or null for "no preference"
-- and for every other visibility product. The Buy page shows how many of
-- FEATURED_SLOTS.cap are left each month (src/lib/featured-availability.ts),
-- counted the same way saveFeaturedMemberPlacement counts its cap, and the
-- console's Interest page links straight to Book a slot with those dates.
--
-- A request is not a booking: nothing is held, and Jas still confirms.
-- RLS is unchanged — members insert through the server action only
-- (20261016000060), and member_read_own_requests covers the new column.
alter table visibility_requests
  add column if not exists preferred_month date;

alter table visibility_requests drop constraint if exists visibility_requests_preferred_month_first;
alter table visibility_requests add constraint visibility_requests_preferred_month_first
  check (preferred_month is null or extract(day from preferred_month) = 1);
