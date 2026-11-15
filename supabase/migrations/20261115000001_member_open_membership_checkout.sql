-- The membership Checkout Session currently open for a member (#5, formerly
-- GAPS B1.8; decision in docs/adr/0003-one-payable-membership-checkout-per-member.md).
--
-- Every press of "Pay £40/month" created a new embedded Checkout Session, and
-- the Idempotency-Key only merged presses within the same minute. Two tabs
-- opened more than a minute apart were two payable sessions; paying both made
-- two £40/month subscriptions, and the second checkout.session.completed
-- overwrote members.stripe_subscription_id, so the first kept billing with
-- nothing in SMI pointing at it.
--
-- The pay action now remembers the session it opened here and hands the same
-- one back while it is open (src/lib/membership-checkout.ts), the way advert
-- invoices do with invoices.checkout_session_id (20261016000002). Replacing it
-- is a compare-and-swap on this column, so two racing tabs end with one
-- stored session and the loser's is expired at Stripe. Redeeming a promo code
-- expires it and clears it.
--
-- Separate from stripe_subscription_id, which is the subscription a PAID
-- checkout created. Only the session id and its expiry are stored, never the
-- client secret, which is read back from Stripe each time it is needed.
--
-- Columns on members, which already has RLS; no policy changes.
-- Additive and idempotent.

alter table members
  add column if not exists membership_checkout_session_id text,
  add column if not exists membership_checkout_expires_at timestamptz;

-- The new console notification for a second subscription that got through
-- anyway (ADR 0003): the payment is recorded, the original subscription stays
-- tracked, and Jas is told to cancel and refund the duplicate in Stripe.
-- Same drop-and-recreate as 20260928000005, with the list repeated verbatim
-- plus the one new kind.

alter table inbox_messages drop constraint if exists inbox_messages_kind_check;
alter table inbox_messages add constraint inbox_messages_kind_check
  check (kind in (
    -- messages: a person wrote this
    'contact', 'advertising', 'membership',
    -- notifications: something happened
    'signup_started', 'payment_taken', 'page_submitted', 'payment_failed',
    'subscription_ended', 'comp_expired', 'membership_lapsed', 'advert_ending',
    'story_submitted', 'video_submitted', 'event_submitted', 'machine_submitted',
    'advert_submitted', 'artwork_submitted',
    'page_edit_submitted',
    'duplicate_subscription'
  ));
