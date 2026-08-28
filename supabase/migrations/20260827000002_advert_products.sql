-- Advert product catalog: sellable ad "spots" (rate-card items like "MPU Box"
-- or "Skyscraper") — distinct from advert_slots (page-position inventory) and
-- adverts (an advertiser's actual booked artwork). cap is informational, same
-- as advert_slots.cap: nothing in lib/adverts.ts enforces it against bookings.

create table advert_products (
  id uuid primary key default gen_random_uuid(),
  short_name text not null,
  description text,
  format text not null check (format in (
    'banner', 'supplier_logo', 'newsletter_banner', 'association_logo',
    'skyscraper', 'mpu', 'in_feed'
  )),
  sample_path text,
  cap int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table advert_products enable row level security;
-- no policies: admin/service-role only, same bucket as adverts, advertisers,
-- advert_bookings, advert_slots and placements.
