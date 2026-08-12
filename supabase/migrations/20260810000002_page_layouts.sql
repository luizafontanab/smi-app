-- Block layouts for public write pages (story / member profile / featured machine).
-- entity_id null = the page-type default template; non-null = per-page override.
-- Ad blocks reference rotation SLOTS only — advertiser assignment stays with the
-- uniform per-request shuffle (rotational-neutral contract, module 04).
create table page_layouts (
  id uuid primary key default gen_random_uuid(),
  page_type text not null check (page_type in ('story', 'member_profile', 'featured_machine')),
  entity_id uuid,
  layout jsonb not null,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (page_type, entity_id)
);

-- service-role only, like the advert tables (RLS on, no policies)
alter table page_layouts enable row level security;

-- inventory rows for the derived layout slot keys, so the console slot view stays truthful
insert into advert_slots (key, label, cap) values
  ('story_ad_1', 'Story page — position 1', 3),
  ('story_ad_2', 'Story page — position 2', 3),
  ('story_ad_3', 'Story page — position 3', 3),
  ('member_ad_1', 'Member page — position 1', 3),
  ('member_ad_2', 'Member page — position 2', 3),
  ('machine_ad_1', 'Featured Machine page — position 1', 3),
  ('machine_ad_2', 'Featured Machine page — position 2', 3)
on conflict (key) do nothing;
