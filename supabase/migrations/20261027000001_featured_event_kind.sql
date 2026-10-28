-- Featured Event becomes a bookable placement (HUMAN-TODO 4.4, answered
-- "sellable"). Until now the homepage's "Featured event" card just showed the
-- next upcoming event: placement_kind had no member to book against
-- (see the note on GhEventCard, components/grid-home/cards.tsx).
--
-- The enum value is added on its own here, because a new enum value can't be
-- used in the same transaction that adds it (cf. 20260831000007_event_types.sql).
-- The column and constraints that use it are in 20261027000002.
alter type placement_kind add value if not exists 'featured_event';
