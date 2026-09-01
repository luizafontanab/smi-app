-- Event types (V11/M4): webinar / live event / open house / exhibition /
-- golf challenge. text + check, not a new enum — same reasoning as
-- 20260829000002_advert_lifecycle.sql: a new enum value can't be used in the
-- same transaction that adds it, and featured_machines/newsletter_issues/
-- dev_tasks/advert_bookings all chose text + check for this kind of fixed list.
--
-- Nullable: existing events have no natural type, and an untyped event simply
-- renders without a type badge.
alter table events
  add column type text check (type in ('webinar', 'live_event', 'open_house', 'exhibition', 'golf_challenge'));
