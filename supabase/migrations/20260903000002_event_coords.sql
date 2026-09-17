-- Event coordinates for the public /event map (fix-list item 2). Nullable
-- double precision, matching members.lat/lng (20260808000001_core.sql):
-- coords are filled by geocoding the `location` text on save only (Nominatim
-- usage policy — never bulk, never at render), so existing rows stay null
-- until they're next saved and simply don't get a pin.
alter table events
  add column lat double precision,
  add column lng double precision;
