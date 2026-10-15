-- Direct uploads: a private staging bucket the browser uploads into, and the
-- listing the cleanup sweep needs (lib/staged-upload).
--
-- Why: every upload rode inside a server-action request, and Vercel caps a
-- Function's request body at 4.5MB (413 FUNCTION_PAYLOAD_TOO_LARGE), whatever
-- next.config's bodySizeLimit says. Images are allowed up to 8MB and PDFs up
-- to 20MB, so an ordinary phone photo passed the form's own check and then
-- failed at the platform as "check your connection". Now the browser sends
-- the bytes straight to Storage through a signed upload URL the server issues
-- for one fresh path, and the form posts only that path; the action then
-- validates the bytes and writes the final object to `media` exactly as it
-- does for a posted file.
--
-- The bucket, and why each setting:
--   · private — what lands here has not been validated yet. `media` is
--     public, so staging there would serve an unchecked upload (an HTML page
--     calling itself image/png) to anyone with the URL. Nothing reads this
--     bucket but the service key.
--   · file_size_limit 20MB — MAX_DOC_BYTES, the largest thing any form
--     accepts (lib/upload-limits). A signed upload URL carries no size limit
--     of its own, so this is what stops a caller staging more than any form
--     would take. The per-kind caps (8MB images) are enforced on the bytes
--     when they are claimed.
--   · allowed_mime_types — ALLOWED_IMAGE_TYPES plus ALLOWED_DOC_TYPES. Only
--     the declared type, so a first refusal; the real type is still read
--     from the bytes on claim.
-- tests/unit/staged-upload.test.ts checks these against lib/upload-limits so
-- the two can't drift. Upserted, so a bucket made by hand (or an earlier run)
-- ends up with exactly these settings.
--
-- No storage.objects policy is added, for this bucket or any other: there are
-- none today (anon and authenticated can write nothing), and a signed upload
-- URL works without one — the token authorises its one path, nothing else.
-- So this loosens nothing.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'upload-staging',
  'upload-staging',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Staged objects older than p_before, oldest first, for the
-- upload_staging_sweep job: a form a file was chosen for and then abandoned.
-- A database read rather than a walk of the bucket through the storage API,
-- which lists one folder at a time — one call per member. Names only: the job
-- deletes through the storage API, which removes the bytes as well as the row.
--
-- Read-only and invoker rights; service_role only, like every maintenance
-- function since 20260816000002. p_limit is clamped so no caller can ask for
-- the whole table at once.

create or replace function staged_uploads_older_than(p_before timestamptz, p_limit int default 100)
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'upload-staging'
    and o.created_at < p_before
  order by o.created_at
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;

revoke execute on function staged_uploads_older_than(timestamptz, int) from public, anon, authenticated;
grant execute on function staged_uploads_older_than(timestamptz, int) to service_role;

notify pgrst, 'reload schema';
