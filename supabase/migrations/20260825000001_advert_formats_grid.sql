-- Three more paid formats, for the bundle Jas wants to sell: "rather than just
-- buying a banner, they buy a package that includes a banner, logo, box, mobile,
-- sky scrapper, newsletter etc which we simply rotate amongst".
--
--   skyscraper  300x600  tall rail, desktop only in practice
--   mpu         300x250  the "box" — sits inside a rail or between bands
--   in_feed     native   a card in a content grid, always labelled Sponsored
--
-- Mobile is deliberately NOT a format: every advert already carries both
-- desktop_path and mobile_path, so "mobile" in that list is a creative, not a
-- separate piece of inventory to book.
--
-- Site takeovers are still to come; placement_kind already carries 'takeover'.
alter table adverts drop constraint if exists adverts_format_check;

alter table adverts add constraint adverts_format_check
  check (format in (
    'banner', 'supplier_logo', 'newsletter_banner', 'association_logo',
    'skyscraper', 'mpu', 'in_feed'
  ));
