-- Which of these media paths does anything still point at? (review finding,
-- 16 Oct: deleting a member's story draft orphaned the photos in its body.)
--
-- dashboard/actions.ts deleteStoryDraft removed the draft's cover and nothing
-- else, so every image the member had dropped into the body — uploaded under
-- stories/<member id>/ by memberUploadImage — stayed in the public bucket and
-- in the media library with no row pointing at it. Removing them is right;
-- removing one that is still in use is not, and "in use" can be anywhere: the
-- media library (A1.4) shows every upload to the desk, who can copy any URL
-- into any editor. The member can also have pasted the same image into a
-- second draft.
--
-- So the caller asks before it deletes. Given candidate paths, this returns
-- the ones still referenced — a body or description containing the path
-- (images are stored as full public URLs ending in it, so a substring match
-- is the test), or a *_path column equal to it. strpos rather than LIKE: a
-- path is matched literally, with no wildcard to escape.
--
-- The column list is every content column that can hold a media path or URL
-- today (information_schema, 16 Oct). A new one must be added here, or a
-- draft deletion could remove an image it shows; the failure mode of an
-- omission is a broken image, which is why the caller only ever offers paths
-- under the member's own prefix plus the draft's own cover.
--
-- Read-only and invoker rights; service_role only, like every maintenance
-- function since 20260816000002 — a member must not be able to probe what the
-- desk has used through /rest/v1/rpc.

create or replace function media_paths_in_use(p_paths text[])
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select p
  from unnest(coalesce(p_paths, '{}'::text[])) as p
  where p <> ''
    and (
      exists (select 1 from stories where strpos(body, p) > 0 or cover_path = p)
      or exists (select 1 from members where strpos(description, p) > 0 or logo_path = p or hero_path = p)
      or exists (select 1 from member_revisions where strpos(payload::text, p) > 0)
      or exists (select 1 from events where strpos(description, p) > 0 or cover_path = p)
      or exists (select 1 from videos where strpos(description, p) > 0 or thumbnail_path = p)
      or exists (select 1 from featured_machines where strpos(description, p) > 0 or image_path = p)
      or exists (select 1 from static_pages where strpos(body, p) > 0)
      or exists (select 1 from newsletter_issues where strpos(intro, p) > 0)
      or exists (select 1 from page_layouts where strpos(layout::text, p) > 0)
      or exists (select 1 from adverts where desktop_path = p or mobile_path = p)
      or exists (select 1 from advert_artwork_proposals where desktop_path = p or mobile_path = p)
      or exists (select 1 from advert_products where sample_path = p or strpos(description, p) > 0)
      or exists (select 1 from email_templates where strpos(body_html, p) > 0 or strpos(body_text, p) > 0)
      or exists (select 1 from settings where strpos(value::text, p) > 0)
      or exists (select 1 from resources where path = p)
    );
$$;

revoke execute on function media_paths_in_use(text[]) from public, anon, authenticated;
grant execute on function media_paths_in_use(text[]) to service_role;

notify pgrst, 'reload schema';
