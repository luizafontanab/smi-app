-- SMI commerce: adverts (module 04), placements, newsletter, CRM mirror, invoices
-- NEUTRALITY: rotation is random-uniform. There is deliberately NO weight,
-- priority, or bid column anywhere in this schema — do not add one.

create table advertisers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  member_id uuid references members(id) on delete set null,
  contact_email text,
  created_at timestamptz not null default now()
);

create table adverts (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references advertisers(id) on delete cascade,
  name text not null,
  desktop_path text not null,
  mobile_path text not null,
  -- null link_url means default target: the advertiser's SMI member page
  link_url text,
  created_at timestamptz not null default now()
);

-- a booked run; artwork on the advert can be swapped mid-run without touching dates
create table advert_bookings (
  id uuid primary key default gen_random_uuid(),
  advert_id uuid not null references adverts(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  bundle_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

-- slot definitions with caps Jas can set (home_1..3, siderail_a/b, news_mid, footer)
create table advert_slots (
  key text primary key,
  label text not null,
  cap int not null default 3
);

create type placement_kind as enum ('featured_member', 'featured_machine', 'grid_block', 'takeover');

create table featured_machines (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  name text not null,
  description text,
  image_path text,
  external_url text,
  created_at timestamptz not null default now()
);

-- paid placements hold their spot for the paid period (grid_position for grid buys)
create table placements (
  id uuid primary key default gen_random_uuid(),
  kind placement_kind not null,
  member_id uuid references members(id) on delete cascade,
  featured_machine_id uuid references featured_machines(id) on delete cascade,
  grid_position int,
  config jsonb not null default '{}', -- takeover: {hex, banner_path}
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table bundles (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references advertisers(id) on delete cascade,
  name text not null,
  price_pennies int,
  notes text,
  created_at timestamptz not null default now()
);
alter table advert_bookings
  add constraint advert_bookings_bundle_fk foreign key (bundle_id) references bundles(id) on delete set null;

-- newsletter (composed in admin, sent via adapter, also published as a web page)
create table newsletter_issues (
  id uuid primary key default gen_random_uuid(),
  number int not null unique,
  subject text not null,
  intro text,
  status text not null default 'draft' check (status in ('draft', 'sent')),
  web_slug text unique,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table newsletter_items (
  issue_id uuid references newsletter_issues(id) on delete cascade,
  story_id uuid references stories(id) on delete cascade,
  position int not null,
  primary key (issue_id, story_id)
);

create table newsletter_ads (
  issue_id uuid references newsletter_issues(id) on delete cascade,
  advert_id uuid references adverts(id) on delete cascade,
  position int not null,
  primary key (issue_id, advert_id)
);

-- local Bigin mirror; sync via CrmSync adapter. Unsubscribe is permanent:
-- unsubscribed_at is never cleared by sync, only by explicit re-opt-in.
create table contacts (
  id uuid primary key default gen_random_uuid(),
  bigin_id text unique,
  email text not null unique,
  name text,
  company text,
  member_id uuid references members(id) on delete set null,
  subscribed boolean not null default true,
  unsubscribed_at timestamptz,
  source text,
  social jsonb not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  number text not null unique,
  amount_pennies int not null,
  issued_on date not null,
  pdf_path text,
  status text not null default 'issued' check (status in ('issued', 'paid', 'void')),
  created_at timestamptz not null default now()
);

-- member "Buy" requests: no online payment — Jas confirms and invoices (assumption #3)
create table visibility_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  product text not null,
  message text,
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'declined')),
  created_at timestamptz not null default now()
);

create index advert_bookings_active_idx on advert_bookings (starts_on, ends_on);
create index placements_active_idx on placements (kind, starts_on, ends_on);
