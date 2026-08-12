-- Format A is sold as rotation "across homepage, news, articles, videos and the
-- member directory" (advertising page) and REQUIREMENTS.md asks for adverts on
-- every page, but /videos, /events and /members carried no slot at all. Adding
-- the inventory rows so the console slot view matches what the site renders.
insert into advert_slots (key, label, cap) values
  ('videos_mid', 'Videos page — mid-page', 3),
  ('events_mid', 'Events page — mid-page', 3),
  ('directory_mid', 'Member directory — mid-page', 3)
on conflict (key) do nothing;
