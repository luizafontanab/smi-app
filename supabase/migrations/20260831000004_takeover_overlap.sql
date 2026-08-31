-- A homepage takeover is site-wide: only one advertiser's colours can be live
-- at once, unlike advert_bookings_no_overlap (scoped per-advert, since two
-- different adverts running concurrently is legitimate). Same btree_gist
-- mechanism, already enabled by 20260829000002_advert_lifecycle.sql.

alter table placements add constraint placements_takeover_no_overlap
  exclude using gist (
    daterange(starts_on, ends_on, '[]') with &&
  ) where (kind = 'takeover');

notify pgrst, 'reload schema';
