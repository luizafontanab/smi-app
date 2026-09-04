-- Testimonials removed product-wide (docs/fix list.md item 13, 2 Sep 2026).
-- Scrub pending revision payloads first: decideRevision spreads the stored
-- payload into members.update(), which would fail on an unknown column
-- once testimonials is gone.
update member_revisions set payload = payload - 'testimonials' where payload ? 'testimonials';
alter table members drop column testimonials;
notify pgrst, 'reload schema';
