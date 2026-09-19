-- A fourth banner size: 830x170, for the grid homepage's "Latest videos" band.
--
-- That band now runs a Featured members box down its left in a 3fr column, with
-- the advert beneath the videos in the 9fr column beside it — about 825px wide
-- rather than the full 1120px. A 1280x170 creative dropped into that column
-- renders ~110px tall instead of ~153px, so the position gets its own size:
-- same height, narrower.
--
-- Why a FORMAT and not just a narrower render of 'banner': an adverts row holds
-- exactly one desktop_path, and lib/adverts.ts deals the whole 'banner' pool
-- across every banner slot on the site. 830x170 artwork booked as 'banner'
-- would turn up in home_1, home_3, /news and /member and render chunky in all
-- of them. A separate format is the only way the narrow slot can be guaranteed
-- artwork cut for it.
--
-- Slot key is new too — 'home_2_narrow', not a reuse of 'home_2'. The forge
-- homepage still renders home_2 as a full-width banner, and advert_slots has no
-- format column to tell two creative sizes apart under one key.
--
-- Supersedes nothing. Closes the advert half of docs/fix-list.md item 61; the
-- featured-member half of docs/HUMAN-TODO.md §14.3 lands with it. No new table,
-- so no RLS statement is owed here.

alter table adverts drop constraint if exists adverts_format_check;

alter table adverts add constraint adverts_format_check
  check (format in (
    'banner', 'banner_narrow', 'supplier_logo', 'newsletter_banner',
    'association_logo', 'skyscraper', 'mpu', 'in_feed'
  ));

alter table advert_products drop constraint if exists advert_products_format_check;

alter table advert_products add constraint advert_products_format_check
  check (format in (
    'banner', 'banner_narrow', 'supplier_logo', 'newsletter_banner',
    'association_logo', 'skyscraper', 'mpu', 'in_feed'
  ));

insert into advert_slots (key, label, cap) values
  ('home_2_narrow', 'Homepage banner 2 — grid design (830×170)', 3)
on conflict (key) do nothing;
