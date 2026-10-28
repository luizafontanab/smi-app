-- Featured Event placements (HUMAN-TODO 4.4): a dated, optionally priced
-- booking of the homepage's top event card, managed at
-- /console/adverts/featured-event exactly like Featured Member.
--
-- event_id: the event being promoted. on delete cascade, as member_id is —
-- a deleted event can't be featured, and its invoice survives the booking
-- (invoices.placement_id is on delete set null). member_id is still set, from
-- the event's own member, so invoicing and rebilling work unchanged.
--
-- One at a time: the top card holds a single event, so bookings may not
-- overlap — the same GiST exclusion as placements_takeover_no_overlap
-- (20260831000004). btree_gist is already enabled.
--
-- The backup event shown when nothing is booked is a settings row
-- (key featured_event_backup), not a schema change. RLS is unchanged:
-- placements stays service-role only (20260808000004_search_rls.sql).
alter table placements
  add column if not exists event_id uuid references events(id) on delete cascade;

alter table placements drop constraint if exists placements_featured_event_has_event;
alter table placements add constraint placements_featured_event_has_event
  check (kind <> 'featured_event' or event_id is not null);

alter table placements drop constraint if exists placements_featured_event_no_overlap;
alter table placements add constraint placements_featured_event_no_overlap
  exclude using gist (
    daterange(starts_on, ends_on, '[]') with &&
  ) where (kind = 'featured_event');

create index if not exists placements_event_id_idx on placements (event_id);

notify pgrst, 'reload schema';
