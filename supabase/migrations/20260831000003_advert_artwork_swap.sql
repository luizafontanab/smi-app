-- Artwork-swap review (approvals.kind='advert_artwork', added in
-- 20260829000002, was never given a table to point at). A proposal is scoped
-- to the advert, not the booking, because the lifecycle already forbids two
-- overlapping live/scheduled bookings of one advert (advert_bookings_no_overlap)
-- — so "the current run of this artwork" is unambiguous without a booking_id.
--
-- Staged in its own table rather than columns on `adverts`: the live
-- desktop_path/mobile_path must not change until a member's proposal is
-- approved, and 20260829000002 already drew the line that lifecycle state
-- lives off `adverts` entirely ("lives on advert_bookings, not adverts").
--
-- Only a MEMBER's own proposal is ever 'pending'. An admin proposing a swap
-- on a member's behalf is selling/fulfilling it, same reasoning saveBooking
-- already applies to bookings — there is nobody else to ask, so it applies
-- immediately and is recorded already-'approved' for the audit trail.

create table advert_artwork_proposals (
  id uuid primary key default gen_random_uuid(),
  advert_id uuid not null references adverts(id) on delete cascade,
  desktop_path text not null,
  mobile_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source text not null check (source in ('admin', 'member')),
  submitted_by uuid references profiles(user_id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references profiles(user_id),
  decided_at timestamptz,
  review_reason text,
  updated_at timestamptz not null default now()
);

-- a member cannot queue a second request behind one still awaiting a decision
create unique index advert_artwork_proposals_one_pending
  on advert_artwork_proposals (advert_id) where status = 'pending';

create index advert_artwork_proposals_advert_idx on advert_artwork_proposals (advert_id);

-- service-role only, same as advert_bookings/adverts: every write goes through
-- a server action that checks ownership itself (RLS is bypassed there anyway)
alter table advert_artwork_proposals enable row level security;

notify pgrst, 'reload schema';
