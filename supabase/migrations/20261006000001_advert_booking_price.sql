-- fix-list 77: the rate card goes; a booking carries its own price.
--
-- advert_products was a menu of named products with a rate each, and a booking
-- invoiced off whichever product it was "sold as". In practice the products were
-- a second, looser description of the advert's format, the rates were invented
-- (HUMAN-TODO 17.10 removed them from production), and Jas prices deals one by
-- one. So the price moves onto the booking itself — the same shape bundles
-- already have (bundles.price_pennies) — and saveBooking / decideAdvertBooking
-- invoice off it.
--
-- Not destructive: advert_products and advert_bookings.product_id stay. Nothing
-- reads or writes them any more, but dropping them would lose the record of
-- what older runs were sold as. The backfill below copies a product's rate onto
-- any booking that pointed at one and has no price yet, so a product Jas did
-- enter on production survives as the price of the runs sold under it.
-- Idempotent: re-running it changes nothing.

alter table advert_bookings
  add column if not exists price_pennies int check (price_pennies >= 0);

update advert_bookings b
   set price_pennies = p.rate_pennies
  from advert_products p
 where b.product_id = p.id
   and b.price_pennies is null
   and p.rate_pennies is not null;
