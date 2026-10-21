-- Gap review area 5, slice B (GAPS B5.8): the newsletter blocks Jas's 16 Oct
-- SOP lists that the live issues don't have yet (SOP §1b/§1c).
--
-- 1. Sponsored story. The SOP has the advertiser supply it like any other
--    creative — image 600×400, up to 80 words, click-through URL, marked
--    "Sponsored" — so it is advert artwork in a new format rather than a field
--    on the issue (Luiza, 21 Oct). That keeps artwork approval, swaps and the
--    /visit/[id] click tracking a paid slot bills against. Its words live on
--    the advert: `headline` and `body`, null for every other format. No check
--    ties them to the format, because the console can change an advert's
--    format and the words must survive a format being corrected.
--
-- 2. Supplier directory. Hand-picked members per issue ("Supplier directory
--    listings near the footer"), rendered in name order — a directory, so
--    there is no position to keep. Console-managed like newsletter_ads, and
--    read by the web copy of a sent issue through the service role the same
--    way.
--
-- The events diary needs no schema: it reads published events in the 30 days
-- from the issue's send date.

alter table adverts drop constraint if exists adverts_format_check;
alter table adverts add constraint adverts_format_check check (format in (
  'banner', 'banner_narrow', 'supplier_logo', 'newsletter_banner', 'association_logo',
  'skyscraper', 'mpu', 'in_feed', 'sponsored_story'
));

alter table adverts add column if not exists headline text;
alter table adverts add column if not exists body text;

create table if not exists newsletter_directory (
  issue_id uuid not null references newsletter_issues(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, member_id)
);

alter table newsletter_directory enable row level security;
-- no policies: console-managed; the email render and the web copy of a sent
-- issue read it with the service role, like newsletter_ads.
