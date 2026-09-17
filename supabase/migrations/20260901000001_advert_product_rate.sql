-- Billing on advert approval / visibility confirm (A2.6/A2.7): advert_products
-- had no price at all. Nullable, not backfilled — existing products predate a
-- rate card, and a fabricated number would be worse than an admin seeing
-- "no rate set, invoice manually."
alter table advert_products add column rate_pennies int;
