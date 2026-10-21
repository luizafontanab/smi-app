-- The `media` and `invoices` buckets, as a migration instead of tribal
-- knowledge in the seed scripts (HUMAN-TODO 17.2, and 8.2 on production).
--
-- Why: both buckets were only ever made by `createBucket` in scripts/seed.ts
-- and scripts/seed-real.ts. A schema-only setup — `supabase db push` onto a
-- fresh project with no seed run — produced a project with no buckets: every
-- image 404s, every upload fails, and invoice PDFs fail soft (the invoice row
-- records, `pdf_path` stays null). `upload-staging` already comes from
-- 20261016000070; with this, every bucket the app touches is created by a
-- migration, and tests/unit/storage-buckets.test.ts keeps it that way.
--
-- The buckets, as the seeds have always made them:
--   · media    — public. Every image and document on the site is served by
--     its public URL (lib/media.ts), so it must stay public.
--   · invoices — private. PDFs carry member names, addresses and amounts, and
--     are served only through signed URLs (lib/invoice-pdf.ts).
--
-- Safe on a project that already has them (production does, from the 24 Sep
-- seed:prod): an existing bucket keeps its contents and every other setting.
-- Only `public` is enforced, since it is the one setting that is a security
-- property rather than a preference — an `invoices` bucket someone flipped
-- public by hand is made private again. File-size and type limits are
-- deliberately not added: the existing buckets were made without any, and a
-- limit here could start refusing files that upload fine today. Validation
-- stays in lib/upload-limits, as it is now.
--
-- No storage.objects policy is added, as in 20261016000070: there are none
-- today, so anon and authenticated can write nothing, and the service key
-- the app uses doesn't need one. This loosens nothing.

insert into storage.buckets (id, name, public)
values
  ('media', 'media', true),
  ('invoices', 'invoices', false)
on conflict (id) do update set public = excluded.public;
