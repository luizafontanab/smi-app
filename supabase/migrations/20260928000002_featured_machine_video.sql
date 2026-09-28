-- An optional YouTube video on a Featured Machine listing (GAPS A9.4).
--
-- Raised on the 18 Sep call from real advertiser feedback (REQUIREMENTS §3):
-- the detail page was image + fixed text + an outbound link, so a reader had to
-- leave SMI to see the machine running. A video lets them get the fuller pitch
-- on the page.
--
-- Nullable, not backfilled: every existing listing simply has no video. The
-- value is a YouTube link — the save actions refuse anything youtubeId() can't
-- read (YouTube-only, USE-CASES gap 23), the same rule as videos.url.
--
-- No RLS change: featured_machines already has its policies, and a new column
-- inherits them.

alter table featured_machines add column if not exists video_url text;
