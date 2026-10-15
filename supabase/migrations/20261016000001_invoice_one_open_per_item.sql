-- At most one payable invoice per advert run, bundle or placement (review
-- finding 4, 15 Oct).
--
-- 20261006000002 linked an invoice to what it pays for but indexed the three
-- link columns with plain indexes, so nothing stopped two `issued` invoices
-- pointing at the same booking. A double-clicked console Approve did exactly
-- that: two invoices, two "payment due" emails, two pay links, and a member
-- who could pay both. raiseInvoice() and ensureInvoice() (src/lib/invoicing.ts)
-- now lean on these indexes — a concurrent duplicate fails the insert and
-- resolves to the row that won.
--
-- Only `issued` is unique. A run can legitimately carry a void invoice (its
-- price changed, or its hold lapsed and Jas rebooked it) next to the one that
-- replaced it, and a paid invoice next to nothing — so the history stays.
--
-- The CHECK says what src/lib/invoicing.ts already assumes: an invoice pays
-- for one thing. settle_invoice() (20261016000003) releases whatever the row
-- links to, and a row linking two things would release both for one payment.
--
-- Pre-check: a unique index over existing duplicates fails with a terse
-- "could not create unique index". This raises first instead, naming every
-- conflicting invoice, so whoever runs it against production can see exactly
-- which rows to void by hand (docs/HUMAN-TODO.md has the same query). Nothing
-- is voided automatically: which of two issued invoices the member was told
-- to pay is a judgement, not something a migration can know.
--
-- Idempotent: the pre-check finds nothing on a second run, and every object is
-- created with `if not exists` / dropped first.

do $$
declare
  v_dupes text;
  v_multi text;
begin
  select string_agg(format('%s %s → invoices %s', link, target, ids), E'\n')
    into v_dupes
  from (
    select 'advert_booking_id' as link, advert_booking_id::text as target, string_agg(number || ' (' || id || ')', ', ' order by created_at) as ids
      from invoices where status = 'issued' and advert_booking_id is not null
      group by advert_booking_id having count(*) > 1
    union all
    select 'bundle_id', bundle_id::text, string_agg(number || ' (' || id || ')', ', ' order by created_at)
      from invoices where status = 'issued' and bundle_id is not null
      group by bundle_id having count(*) > 1
    union all
    select 'placement_id', placement_id::text, string_agg(number || ' (' || id || ')', ', ' order by created_at)
      from invoices where status = 'issued' and placement_id is not null
      group by placement_id having count(*) > 1
  ) d;

  select string_agg(format('%s (%s)', number, id), ', ')
    into v_multi
  from invoices
  where num_nonnulls(advert_booking_id, bundle_id, placement_id) > 1;

  if v_dupes is not null or v_multi is not null then
    raise exception 'invoices need resolving by hand before 20261016000001 can apply'
      using detail = concat_ws(E'\n',
        case when v_dupes is not null then E'More than one issued invoice for the same item — void all but the one the member should pay:\n' || v_dupes end,
        case when v_multi is not null then 'Invoices linked to more than one item — each must link to one: ' || v_multi end
      );
  end if;
end $$;

create unique index if not exists invoices_one_issued_per_booking
  on invoices (advert_booking_id) where status = 'issued' and advert_booking_id is not null;
create unique index if not exists invoices_one_issued_per_bundle
  on invoices (bundle_id) where status = 'issued' and bundle_id is not null;
create unique index if not exists invoices_one_issued_per_placement
  on invoices (placement_id) where status = 'issued' and placement_id is not null;

alter table invoices drop constraint if exists invoices_one_link;
alter table invoices add constraint invoices_one_link
  check (num_nonnulls(advert_booking_id, bundle_id, placement_id) <= 1);
