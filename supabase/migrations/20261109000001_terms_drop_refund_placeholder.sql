-- Membership terms: drop the "[SMI TO CONFIRM: … pro-rata refund …]" placeholder
-- under "Cancelling". Decided 9 Nov 2026: no refund is offered when a member
-- cancels, so there is nothing left to confirm. Follows #89 (cancel via SMI).
--
-- The page lives in static_pages and is editable in the console, so the seed
-- change (scripts/lib/static-page-content.ts) alone never reaches a database
-- that is already seeded. This removes the exact placeholder paragraph, with
-- the line break before it, and only where it is still present, so a page
-- whose wording was changed in the console is left alone. If it isn't found,
-- a NOTICE says so, and `supabase db push` shows the page needs a look by hand.
--
-- Data only, no schema change. Idempotent: once removed, the paragraph is gone,
-- so a second run updates nothing (and says so).

do $$
declare
  placeholder constant text :=
    '<p>[SMI TO CONFIRM: whether a pro-rata refund is ever offered mid-period, and on what grounds. The platform does not issue one today.]</p>';
begin
  update static_pages
     set body = replace(replace(body, E'\n' || placeholder, ''), placeholder, ''),
         updated_at = now()
   where slug = 'membership-terms'
     and position(placeholder in body) > 0;

  if not found then
    raise notice 'static_pages membership-terms: refund placeholder not found, left as is';
  end if;
end
$$;
