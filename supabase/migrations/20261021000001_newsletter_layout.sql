-- Gap review area 5 (Jas's 16 Oct newsletter SOP §1b/§1c), slice A: the
-- issue is laid out like the live Mailchimp issues — masthead, lead story,
-- two-up cards, adverts between story rows — and the composer gains the two
-- fields that layout needs stored.
--
-- preview_text: the inbox preview line (the SOP's "preheader", ~90 characters),
-- rendered as a hidden block at the top of the email. Null renders nothing,
-- which is what every issue sent before this did.
--
-- after_item: where an advert sits, as "after item N" (1-based, counting the
-- lead story as item 1). Null means the automatic rule in
-- lib/newsletter-layout.ts places it, so every existing row keeps working
-- with no backfill. A number past the issue's last item is clamped to the end
-- at render time rather than rejected here, because removing a story from the
-- issue must never make a saved placement invalid.
--
-- newsletter_items needs no change: since 20260901000012 each row is one story
-- or one video with its own position, so a mixed, hand-ordered list already fits.

alter table newsletter_issues add column if not exists preview_text text;

alter table newsletter_ads add column if not exists after_item int;
alter table newsletter_ads drop constraint if exists newsletter_ads_after_item_positive;
alter table newsletter_ads add constraint newsletter_ads_after_item_positive check (after_item is null or after_item >= 1);
