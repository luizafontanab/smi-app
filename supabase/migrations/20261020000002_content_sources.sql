-- Story sources: the in-app replacement for ChangeTower (requirements/06-content-os.md
-- "Story discovery"; GAPS "Content OS and the kanban 'suggested' column", deferred
-- by design until now — this is its first slice, not the whole module).
--
-- The list of ~726 company news pages Jas watches lives here once imported
-- (06-content-os: "import it once — after import the list lives in-app"). A
-- daily job reads each one and records links it has never seen before; those
-- become suggestions on /console/sources. Nothing here ever publishes: a
-- suggestion only turns into an ordinary admin draft when someone clicks
-- "Start story", and the approval gate is unchanged. Turning the job off
-- leaves the manual story flow exactly as it was.
--
-- How each source is read is decided per source and stored (`method`): an
-- RSS/Atom feed, the WordPress posts API, the news page's HTML, or the sitemap.
-- The October 2026 coverage test (docs/story-sources.md) found feeds/API on
-- ~59% of the list, HTML on another ~14%, sitemaps ~4%. `access` records why a
-- source can't be read when none of them works — bot-protected, page gone,
-- domain unreachable — so the console can list them rather than hide them.
create table content_sources (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  domain text not null,
  label text,
  active boolean not null default true,
  -- null until the first check has worked out how to read it
  method text check (method in ('feed', 'wp_api', 'html', 'sitemap')),
  -- the feed, API or sitemap address the method reads (the news page itself for 'html')
  method_url text,
  access text not null default 'unknown'
    check (access in ('unknown', 'ok', 'blocked', 'not_found', 'unreachable', 'empty')),
  last_checked_at timestamptz,
  -- null until a check has succeeded: the first good read is a silent baseline
  last_ok_at timestamptz,
  -- newest post date the source has shown, for spotting dormant sources
  last_item_at timestamptz,
  failure_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The job takes the least recently checked active sources first.
create index content_sources_due_idx on content_sources (last_checked_at nulls first) where active;

-- One row per article link ever seen. Unique on the link itself, not per
-- source, so a site listed twice (it happens in the imported list) can't
-- suggest the same article twice.
create table source_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references content_sources(id) on delete cascade,
  url text not null unique,
  title text not null,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  -- baseline: present on the source's first good read, so not news — never shown
  state text not null default 'new' check (state in ('new', 'dismissed', 'drafted', 'baseline')),
  story_id uuid references stories(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index source_items_inbox_idx on source_items (state, first_seen_at desc);
create index source_items_story_idx on source_items (story_id) where story_id is not null;

alter table content_sources enable row level security;
-- no policies: console-managed, read and written via service role only.
alter table source_items enable row level security;
-- no policies: console-managed, read and written via service role only.
