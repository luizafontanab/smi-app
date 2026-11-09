-- Company links Jas picks from Bigin to close a story (Jas 13/10: "ideally i
-- would prefer to select from the BIGIN database, via a drop down/select").
--
-- Every story already ends with a line per featured member, built at render
-- time (lib/company-link). This column holds the extra, non-member companies
-- the story is about, picked in the console story editor from Bigin's
-- Companies: a JSON array of {bigin_id, name, url}, in the order Jas set.
-- bigin_id is null for a company typed in by hand. The URL is copied from
-- Bigin's Website at pick time (or typed when Bigin has none), so a later
-- change in Bigin doesn't follow; it's a link, not a sync.
--
-- Member saves never write it: only the console editor does, so a member
-- editing their story keeps what Jas picked. Read with the story row, so the
-- existing stories policies cover it; no new table, no RLS change.
--
-- Closes "Jas feedback: open items" #3.

alter table stories add column if not exists closing_links jsonb not null default '[]'::jsonb;

alter table stories drop constraint if exists stories_closing_links_is_array;
alter table stories add constraint stories_closing_links_is_array check (jsonb_typeof(closing_links) = 'array');
