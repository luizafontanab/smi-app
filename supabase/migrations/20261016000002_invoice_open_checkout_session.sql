-- The Checkout Session currently open for an invoice (review finding 2, 15 Oct).
--
-- The pay page created a fresh Stripe Checkout Session on every mount, and the
-- idempotency key only collapsed requests inside the same minute. Sessions
-- live an hour, so two tabs — or one tab reloaded a minute later — left two
-- payable sessions for one invoice, and paying both took the money twice.
--
-- The pay action now remembers the session it opened and hands the same one
-- back while it is still open (src/app/dashboard/pay/invoice/actions.ts),
-- creating a new one only when none is. Voiding an invoice expires its open
-- session at Stripe (voidInvoices(), src/lib/advert-payments.ts), so a pay
-- link left open in a tab stops working the moment the invoice is cancelled.
--
-- Separate from stripe_session_id, which records the session that PAID and is
-- unique across invoices (20261006000002); an open session is not yet a
-- payment and is cleared when the invoice settles.
--
-- Only the session id and its expiry are stored — never the client secret,
-- which is read back from Stripe each time it is needed.
--
-- Additive and idempotent.

alter table invoices
  add column if not exists checkout_session_id text,
  add column if not exists checkout_expires_at timestamptz;
