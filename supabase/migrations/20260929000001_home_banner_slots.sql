-- The homepage's three banner positions — home_1, home_2, home_3, rendered by
-- both home designs (home.grid.tsx, home.forge.tsx) — were only ever inserted by
-- scripts/seed.ts and scripts/seed-real.ts, never by a migration. A database
-- built from migrations alone (production included) therefore had no homepage
-- rows on Console → Adverts → Inventory, so the positions that sell best had no
-- cap to set. Adding them here; the seeds use the same labels.
--
-- on conflict do nothing: a seeded database already has these keys (labelled
-- "Homepage banner N") and keeps its rows and caps untouched.
insert into advert_slots (key, label, cap) values
  ('home_1', 'Homepage — top banner', 3),
  ('home_2', 'Homepage — middle banner', 3),
  ('home_3', 'Homepage — bottom banner', 3)
on conflict (key) do nothing;
