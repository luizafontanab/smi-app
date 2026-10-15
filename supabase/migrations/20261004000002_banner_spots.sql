-- Banners are sold as one sitewide pool: N spots (8 today), with no page and
-- no position on a page attached to any of them. Every live banner rotates
-- through every banner position, and each position cycles three of them per
-- page load (src/lib/adverts.ts dealSlots, src/components/AdCarousel.tsx).
--
-- advert_slots modelled the opposite — a cap per physical position (home_1,
-- news_mid, story_ad_1 …) — and nothing ever read those caps: the console's own
-- copy said they "never affect rotation". It was also incomplete in production
-- (HUMAN-TODO §20.2: news_mid/footer and others only ever came from the seeds).
-- Dropped rather than left dormant, so the Inventory page cannot drift back to
-- per-position selling. No foreign key references it. Position keys survive in
-- code only, as identifiers for dealing and the dev placeholder label.
--
-- The one number that is real — how many banner spots we sell — becomes a
-- settings row Jas edits on Console → Adverts → Inventory. It is shown against
-- live bookings, never enforced (an over-sold month is flagged, not blocked).
--
-- Both statements are idempotent: an existing banner_spots row is kept as set.

insert into settings (key, value) values ('banner_spots', '{"count": 8}')
on conflict (key) do nothing;

drop table if exists advert_slots;
