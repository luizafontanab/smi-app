---
status: accepted
---

# A member has at most one payable membership checkout, and a duplicate subscription is flagged, not undone

Until November 2026 every press of "Pay £40/month" opened a new Stripe Checkout Session. An Idempotency-Key only merged presses within the same minute. A member with two tabs open more than a minute apart could pay both, which created two £40/month subscriptions and two SMI-JOIN invoices. The second `checkout.session.completed` also overwrote `members.stripe_subscription_id`, so the first subscription kept billing with nothing in SMI pointing at it (#5, formerly GAPS B1.8). Luiza decided on 9 Nov 2026 to prevent the second payable checkout and to keep a backstop for the race that prevention can't close.

## Consequences

- **The open membership checkout is remembered on the member and reused**, the same way advert invoices remember theirs (`invoices.checkout_session_id`, `invoiceCheckoutSecret`). A second tab gets the same checkout. Replacing a checkout that is about to expire cancels the old one at Stripe first. When two tabs race, a compare-and-swap means one wins and the loser's new checkout is expired. The one-minute Idempotency-Key is no longer what keeps a member to one checkout.
- **Redeeming a promo code cancels the member's open card checkout** at Stripe, so a member on a free promo can't also start a paid subscription from a leftover tab.
- **A second subscription that gets through anyway is flagged, not undone.** If a membership checkout completes for a member who already has a different subscription:
  - The first subscription stays the one SMI tracks. `stripe_subscription_id` is not overwritten.
  - The payment is still recorded as an SMI-JOIN invoice, because the £40 was taken and the books should match Stripe.
  - A console notification tells Jas which member, which subscription, and which invoice. She cancels the subscription and refunds the payment in Stripe herself, then voids the invoice.
  - Nothing is cancelled or refunded automatically.

## Considered options

- **Detect only** (no checkout reuse; alert when a second subscription lands). Rejected: it leaves the common two-tab case to manual clean-up every time.
- **Prevent only** (no webhook change). Rejected: two payments finishing at the same moment can still both succeed, and the overwrite would silently lose track of a live subscription.
- **Auto-cancel and refund the second subscription.** Rejected for now: refunds move money without a person seeing it. The duplicate should be rare once checkouts are reused, so a by-hand fix is cheap.
- **Auto-cancel without refunding.** Rejected: it does half the clean-up and still leaves Jas the refund, while hiding that anything happened.
