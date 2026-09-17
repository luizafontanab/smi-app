-- Advert lifecycle: draft → awaiting_approval → scheduled → live → ended,
-- with review_required carrying a member-visible reason, and renewal chaining
-- an ended run into a fresh draft.
--
-- The lifecycle lives on advert_bookings (the run), not adverts (the artwork).
-- Three of the states are date-range facts and dates only exist here; renewal
-- is "same artwork, new dates" i.e. a second booking against one advert; and
-- artwork swaps must be reviewable without touching run dates. commerce.sql
-- anticipated exactly this: "artwork on the advert can be swapped mid-run
-- without touching dates."
--
-- text + check rather than the content_status enum: that enum carries
-- published/rejected and is shared with stories/videos/events, while this
-- machine needs live/ended/review_required. A new enum value also cannot be
-- used in the transaction that adds it, which would force a pointless split.
-- featured_machines, newsletter_issues and dev_tasks all chose text + check.
--
-- NEUTRALITY still binds: status is not priority. Nothing added here may be
-- read by the rotation path in src/lib/adverts.ts.

alter table advert_bookings
  -- fail closed: a booking nobody approved never renders
  add column status text not null default 'draft',
  add column source text not null default 'admin' check (source in ('admin', 'member')),
  add column submitted_by uuid references profiles(user_id),
  add column submitted_at timestamptz,
  add column approved_by uuid references profiles(user_id),
  add column approved_at timestamptz,
  -- named review_reason, not rejected_reason: the state is "needs a change",
  -- and this string is shown to the member verbatim
  add column review_reason text,
  add column went_live_at timestamptz,
  add column ended_at timestamptz,
  add column ended_by uuid references profiles(user_id),
  add column ended_reason text check (ended_reason in ('term_complete', 'ended_early')),
  add column ended_note text,
  -- These store the ends_on value the notice was sent ABOUT, not the time it
  -- was sent. Extending a run therefore re-arms its warning automatically, and
  -- no stale timestamp can suppress a genuinely new one.
  add column ending_soon_notified_for date,
  add column ended_notified_for date,
  add column renewed_from uuid references advert_bookings(id) on delete set null,
  -- what was sold off the rate card. restrict, not set null: deleting a product
  -- must never erase the record of what a live booking was sold as.
  add column product_id uuid references advert_products(id) on delete restrict,
  add column updated_at timestamptz not null default now();

-- Backfill before the constraints land, so the cross-column checks validate.
-- Existing rows are admin-sold and legitimately running; they take the state
-- their dates imply rather than the 'draft' default.
update advert_bookings set
  status = case
    when ends_on < current_date   then 'ended'
    when starts_on > current_date then 'scheduled'
    else 'live'
  end,
  -- historical approval is real but unattributed: stamp the time, leave the
  -- person null so the console shows "—" rather than inventing an approver
  approved_at = created_at,
  submitted_at = created_at,
  updated_at = now();

update advert_bookings
   set went_live_at = starts_on::timestamptz
 where status in ('live', 'ended');

update advert_bookings
   set ended_at = (ends_on + 1)::timestamptz,
       ended_reason = 'term_complete'
 where status = 'ended';

-- Suppress a deploy-day notification burst: without these, the first sweep
-- emails every advertiser whose run already ended or happens to end this week.
update advert_bookings set ended_notified_for = ends_on where status = 'ended';
update advert_bookings set ending_soon_notified_for = ends_on
 where status = 'live' and ends_on <= current_date + 7;

alter table advert_bookings add constraint advert_bookings_status_check
  check (status in ('draft', 'awaiting_approval', 'review_required', 'scheduled', 'live', 'ended'));

-- "sent back with a reason" is a product requirement, so the reason is
-- structurally mandatory rather than merely nullable as on stories/videos
alter table advert_bookings add constraint advert_bookings_review_reason_check
  check (status <> 'review_required' or coalesce(btrim(review_reason), '') <> '');

-- "ended is explicitly recorded, not just hidden"
alter table advert_bookings add constraint advert_bookings_ended_stamp_check
  check ((status = 'ended') = (ended_at is not null));

-- defence in depth on the approval gate, independent of any app-side predicate
alter table advert_bookings add constraint advert_bookings_approved_stamp_check
  check (status not in ('scheduled', 'live', 'ended') or approved_at is not null);

alter table advert_bookings add constraint advert_bookings_renewed_from_self_check
  check (renewed_from is null or renewed_from <> id);

-- Overlapping runs of ONE piece of artwork are an accidental weighting mechanism:
-- liveBookings() maps bookings→adverts, so the same advert booked twice over
-- the same days enters the rotation array twice and doubles its share. That is
-- a weight, in the one module that forbids weights.
--
-- Scoped to advert, not member, deliberately: a member running two DIFFERENT
-- adverts concurrently legitimately holds two entries — that is buying
-- volume, which the bundle sells. The same artwork twice is buying nothing.
--
-- The partial WHERE keeps renewals legal: an ended run is outside the
-- constraint, so a renewal may start the day the previous one ends.
create extension if not exists btree_gist;
alter table advert_bookings add constraint advert_bookings_no_overlap
  exclude using gist (
    advert_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status in ('scheduled', 'live'));

-- mirrors the render predicate (status ∈ renderable AND date in term)
create index advert_bookings_render_idx on advert_bookings (starts_on, ends_on)
  where status in ('scheduled', 'live');
-- the daily sweep's three queries
create index advert_bookings_sweep_idx on advert_bookings (status, ends_on);
create index advert_bookings_product_idx on advert_bookings (product_id) where product_id is not null;
create index advert_bookings_renewed_from_idx on advert_bookings (renewed_from) where renewed_from is not null;
drop index if exists advert_bookings_active_idx;  -- superseded by advert_bookings_render_idx

-- retire a rate-card line without destroying what past runs were sold as
alter table advert_products add column archived_at timestamptz;

alter table adverts add column updated_at timestamptz not null default now();

-- two distinct decisions with different subjects: may this run go ahead, and
-- is this replacement artwork acceptable
alter table approvals drop constraint if exists approvals_kind_check;
alter table approvals add constraint approvals_kind_check
  check (kind in ('story', 'event', 'member_revision', 'member_activation',
                  'machine', 'video', 'advert_booking', 'advert_artwork'));

-- PostgREST can serve a stale schema cache after a push and reject the new
-- columns; the render path discards its error, so that would surface as ads
-- silently vanishing rather than as a failure.
notify pgrst, 'reload schema';
