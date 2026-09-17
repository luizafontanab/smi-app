-- Media library (A1.4): a listable record of what uploadImage/uploadDocument
-- put in the public `media` bucket. Console-only, service-role only — no RLS
-- policies, same as adverts/advertisers/advert_products etc.
--
-- uploaded_by is left unpopulated for now: threading a user id through the
-- ~28 call sites across console + member upload paths that call
-- uploadImage/uploadDocument is out of scope for closing this gap. Existing
-- objects uploaded before this migration have no row here — the library
-- starts capturing going forward.
create table media (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,
  kind text not null check (kind in ('image', 'document')),
  content_type text not null,
  byte_size integer,
  original_name text,
  alt_text text,
  uploaded_by uuid references profiles(user_id),
  created_at timestamptz not null default now()
);

create index media_created_idx on media (created_at desc);

alter table media enable row level security;
-- no policies: admin/service-role only, same as advert_products.
