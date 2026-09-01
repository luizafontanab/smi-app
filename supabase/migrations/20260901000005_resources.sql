-- Member resources library (GAPS A4.16): /dashboard/resources was a single
-- hardcoded generated graphic with no way to add anything else. This is an
-- addable/removable list, not a fixed handful of static assets, since the
-- brand pack is expected to grow (logo variants, guidelines, more).
create table resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  path text not null,
  kind text not null check (kind in ('image', 'document')),
  created_at timestamptz not null default now()
);

create index resources_created_idx on resources (created_at desc);

alter table resources enable row level security;
-- no policies: console-managed, member area reads it via service role.
