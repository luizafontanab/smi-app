-- Adverts could only sit before or after a story body, leaving the foot of the
-- page as the only in-article position — the one REQUIREMENTS.md:62 wants moved.
-- An admin can now place breaks inside the body (lib/sanitize splitAtAdBreaks),
-- capped at MAX_AD_BREAKS so readers are not drowned in adverts. Adding the
-- inventory rows so the console slot view matches what the site renders.
--
-- Position-derived keys, as everywhere else: nothing here names an advertiser.
insert into advert_slots (key, label, cap) values
  ('story_body_ad_1', 'Story body — first advert break', 3),
  ('story_body_ad_2', 'Story body — second advert break', 3)
on conflict (key) do nothing;
