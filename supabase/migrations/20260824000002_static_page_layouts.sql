-- Static pages join the block-layout system, so editors arrange them the way
-- they already arrange story and member pages.

-- page_layouts.entity_id is uuid; static_pages is keyed by its text slug. Give
-- static_pages a surrogate id rather than widening entity_id — the other three
-- page types all key on a uuid, and loosening the column would give up the FK
-- shape they rely on. slug stays the routing key and stays unique.
alter table static_pages add column id uuid not null default gen_random_uuid();
create unique index static_pages_id_key on static_pages (id);

alter table page_layouts drop constraint page_layouts_page_type_check;
alter table page_layouts add constraint page_layouts_page_type_check
  check (page_type in ('story', 'member_profile', 'featured_machine', 'static_page'));

-- Inventory rows for the slot keys adSlotKeys() derives for this page type, so
-- the console slot view reports the real amount of space on offer.
insert into advert_slots (key, label, cap) values
  ('page_ad_1', 'Content page — position 1', 3),
  ('page_ad_2', 'Content page — position 2', 3)
on conflict (key) do nothing;
