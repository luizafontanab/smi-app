-- Story sources from Bigin: fall back to the company's Website (Luiza, 5 Nov 2026).
--
-- 20261027000004 made each Bigin company's "News Page URL" a story source.
-- Most companies have no news page filled in, so the sync now uses the
-- company's standard Website field when News Page URL is empty. A homepage
-- still reads well: the checker tries the site's feed, WordPress API and
-- sitemap before the page's own links.
--
-- bigin_from_website marks a source whose Bigin link came from that
-- fallback, so /console/sources can tell a homepage apart from a news page
-- Jas chose. Set and cleared by the sync with bigin_account_id; false on
-- every row not linked to Bigin. Additive and idempotent: no existing row
-- changes (every current link came from a News Page URL).

alter table content_sources add column if not exists bigin_from_website boolean not null default false;
