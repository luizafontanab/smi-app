-- GAPS B1.5: member-side subscription cancellation had no path — no column
-- even existed to remember which Stripe subscription belongs to a member, so
-- there was nothing a cancel action could safely act on.
alter table members add column stripe_subscription_id text;

-- Set while a cancellation is pending (requested, but Stripe's own
-- customer.subscription.deleted webhook hasn't confirmed the period actually
-- ended yet) so the billing page can show "cancels on <date>" rather than
-- silently doing nothing until the subscription disappears.
alter table members add column cancel_requested_at timestamptz;
