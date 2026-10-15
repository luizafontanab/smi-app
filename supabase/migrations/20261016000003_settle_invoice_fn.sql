-- Settle an invoice in one transaction (review finding 1, 15 Oct).
--
-- settleInvoice() (src/lib/advert-payments.ts) used to do this as four
-- separate PostgREST calls, none of which checked for an error:
--
--   · the issued → paid flip ignored its own `error`, so a database failure
--     read exactly like "already paid". The Stripe webhook answered 200,
--     Stripe never retried, and the nightly sweep later ended the member's
--     run as 'unpaid' and voided the invoice they had paid;
--   · the releases (advert_bookings, the bundle's parts, placements) ran after
--     the flip, so a failure part-way left a paid invoice holding a run back —
--     and a replay could not repair it, because the flip had already won;
--   · the receipt was queued after all of that, so a queue error lost it.
--
-- Here the flip, the releases and the receipt job commit together or not at
-- all. Any error raises, so the caller throws and the webhook answers 500 —
-- and Stripe retries until it lands.
--
-- The outcome says why nothing happened when nothing did, which is what lets
-- the webhook tell a harmless replay (paid by this same session) from money
-- taken for nothing (paid by another session, or void):
--
--   settled         — this call paid it; job_id is the queued receipt
--   paid            — already paid; paid_session_id says by which session
--   void            — cancelled before the payment arrived
--   missing         — no such invoice
--   amount_mismatch — p_paid_amount/p_paid_currency given and not this
--                     invoice's; nothing is changed (defence in depth: the
--                     session's amount always comes from the invoice row)
--
-- open_session_id is the Checkout Session the invoice had open (20261016000002),
-- returned so the caller can expire it at Stripe when it is not the one that
-- paid — two tabs opened before that column existed can still hold two.
--
-- Advert invoices are always in pounds (advert-checkout.ts sends gbp), hence
-- the literal below. The receipt's `amount` is formatted exactly as
-- formatPounds() does in TypeScript ("£650.00"), because the email template
-- prints it as given.

create or replace function settle_invoice(
  p_invoice_id uuid,
  p_session_id text default null,
  p_paid_amount int default null,
  p_paid_currency text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  inv invoices%rowtype;
  v_now timestamptz := now();
  v_job uuid;
begin
  select * into inv from invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if inv.status <> 'issued' then
    return jsonb_build_object(
      'outcome', inv.status,
      'member_id', inv.member_id,
      'paid_session_id', inv.stripe_session_id
    );
  end if;

  if (p_paid_amount is not null or p_paid_currency is not null)
     and (p_paid_amount is distinct from inv.amount_pennies or lower(coalesce(p_paid_currency, '')) <> 'gbp') then
    return jsonb_build_object(
      'outcome', 'amount_mismatch',
      'member_id', inv.member_id,
      'expected_pennies', inv.amount_pennies
    );
  end if;

  update invoices
     set status = 'paid',
         paid_at = v_now,
         stripe_session_id = coalesce(p_session_id, stripe_session_id),
         checkout_session_id = null,
         checkout_expires_at = null
   where id = inv.id;

  -- Held → scheduled. The run's own dates then decide whether it shows today
  -- (liveBookings filters on status AND term), and the nightly sweep stamps it
  -- live — so paying mid-term puts it on the site immediately.
  if inv.advert_booking_id is not null then
    update advert_bookings set status = 'scheduled', updated_at = v_now
     where id = inv.advert_booking_id and status = 'awaiting_payment';
  end if;
  if inv.bundle_id is not null then
    update advert_bookings set status = 'scheduled', updated_at = v_now
     where bundle_id = inv.bundle_id and status = 'awaiting_payment';
  end if;
  if inv.placement_id is not null then
    update placements set awaiting_payment = false where id = inv.placement_id;
  end if;

  insert into jobs (kind, payload, due_at)
  values (
    'notify_member',
    jsonb_build_object(
      'member_id', inv.member_id,
      'kind', 'advert_payment_received',
      'invoice_id', inv.id,
      'invoice_ref', inv.number,
      'amount', '£' || to_char(inv.amount_pennies / 100.0, 'FM999999990.00')
    ) || case when inv.advert_booking_id is not null
              then jsonb_build_object('booking_id', inv.advert_booking_id)
              else '{}'::jsonb end,
    v_now
  )
  returning id into v_job;

  return jsonb_build_object(
    'outcome', 'settled',
    'member_id', inv.member_id,
    'job_id', v_job,
    'open_session_id', inv.checkout_session_id
  );
end $$;

revoke execute on function settle_invoice(uuid, text, int, text) from public, anon, authenticated;
grant execute on function settle_invoice(uuid, text, int, text) to service_role;

notify pgrst, 'reload schema';
