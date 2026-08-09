-- SMI core schema: people, members, content
-- Requirements refs: requirements/01..03, USE-CASES.md

create type user_role as enum ('super_admin', 'approver', 'viewer', 'input_only', 'member');
create type member_status as enum ('draft', 'active', 'grace', 'lapsed');
create type content_status as enum ('draft', 'awaiting_approval', 'scheduled', 'published', 'rejected');
create type category_kind as enum ('story', 'member');

create table categories (
  id serial primary key,
  kind category_kind not null,
  slug text not null,
  name text not null,
  unique (kind, slug)
);

create table members (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status member_status not null default 'draft',
  category_id int references categories(id),
  description text,
  address text,
  lat double precision,
  lng double precision,
  phone text,
  website text,
  logo_path text,
  hero_path text,
  video_url text,
  -- exact handles used for social @-tagging; never hand-typed at post time
  social jsonb not null default '{}',
  testimonials jsonb not null default '[]',
  billing_mode text not null default 'card' check (billing_mode in ('card', 'invoice')),
  stripe_customer_id text,
  joined_at date,
  grace_until date,
  created_at timestamptz not null default now()
);

-- app users; one shared login per member company (phase 1)
create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null default 'member',
  member_id uuid references members(id) on delete set null,
  display_name text,
  created_at timestamptz not null default now()
);

create table stories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  body text not null default '',
  status content_status not null default 'draft',
  -- member whose news this is (drives backlink + footer branding + badge)
  member_id uuid references members(id) on delete set null,
  is_member_news boolean not null default false,
  cover_path text,
  -- crop/pan/zoom focus box chosen in the editor: {x, y, scale}
  cover_focus jsonb,
  source text not null default 'admin' check (source in ('admin', 'member', 'import')),
  submitted_by uuid references profiles(user_id),
  rejected_reason text,
  scheduled_at timestamptz,
  published_at timestamptz,
  pinned_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table story_categories (
  story_id uuid references stories(id) on delete cascade,
  category_id int references categories(id) on delete cascade,
  primary key (story_id, category_id)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  location text,
  starts_on date not null,
  ends_on date,
  link text,
  cover_path text,
  member_id uuid references members(id) on delete set null,
  status content_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  url text not null,
  thumbnail_path text,
  member_id uuid references members(id) on delete set null,
  status content_status not null default 'draft',
  source text not null default 'manual' check (source in ('manual', 'curated')),
  published_at timestamptz,
  created_at timestamptz not null default now()
);

-- member profile edits are approval-gated (working assumption #2):
-- edits land here as a pending revision, applied to members on approval
create table member_revisions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  payload jsonb not null,
  status content_status not null default 'awaiting_approval',
  rejected_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table static_pages (
  slug text primary key,
  title text not null,
  body text not null default '',
  updated_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value jsonb not null
);

create index stories_status_published_idx on stories (status, published_at desc);
create index stories_member_idx on stories (member_id) where member_id is not null;
create index events_starts_idx on events (starts_on);
