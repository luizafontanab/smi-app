// The £40 membership rate is the same hardcode as membership.ts
// applyPaymentResult(). Until Jas confirms real rates (then they belong in
// settings), this module is the single place the fixed ones live. Adverts,
// bundles and placements carry their own price (fix-list 77).
export const MEMBERSHIP_MONTHLY_PENNIES = 4000;

// cap raised 4 → 8 on 20 Sep, when the homepage box became a real rotating
// carousel: three are on screen at a time and the rest take their turn, so
// the eighth advertiser gets the same exposure as the first. Enforced only
// here and in console/actions.ts (no DB constraint), and read by the console
// dashboard's slot pips and the Featured Member page's copy.
export const FEATURED_SLOTS = { cap: 8, pennies: 40000 };

/** An invoice as the Command Centre's revenue figure reads it. */
export type RevenueInvoice = {
  number: string;
  amountPennies: number;
  /** The kind of placement it pays for, when it pays for one. */
  placementKind: string | null;
};

/**
 * Advertising (ADV) and visibility (VIS) invoices — the same numbering rule
 * as isPayableOnline() in lib/invoicing, which this module can't import (it
 * pulls in the database client). Membership's SMI-JOIN invoices, and the
 * seed's older SMI-2026-… rows, are the ones it leaves out.
 */
const ADVERTISING_INVOICE = /^SMI-(ADV|VIS)-/;

/**
 * The Command Centre's "Revenue this month", by stream.
 *
 * Advertising and Featured Member slots are the invoices PAID this month —
 * money that arrived, through Stripe or marked paid by hand. They used to be
 * estimated from the bookings live today, which is not what anyone was billed:
 *
 *  - a bundle's parts carry no price (20261016000033) — the bundle is invoiced
 *    once, off bundles.price_pennies — so each part was counted at an invented
 *    per-format rate and the bundle's real price not at all;
 *  - a price is for the whole run, however long, so a year-long banner was
 *    counted in full in every month it showed;
 *  - an unpriced run (billed outside SMI) got the invented rate too, and each
 *    Featured Member slot a flat £400 whatever it sold for.
 *
 * An invoice is one charge for one booking, bundle or placement — at most one
 * open per item (20261016000001), and a void one never counts — so nothing is
 * counted twice. Takeover placements are advertising; only featured_member
 * placements are the featured stream.
 *
 * Membership isn't invoiced month by month — its Stripe subscription renews
 * it, and only the joining payment is recorded — so that stream stays active
 * members × the monthly rate, and SMI-JOIN invoices are left out rather than
 * counted on top of it.
 *
 * `outstanding` is advertising invoiced and not yet paid: shown beside the
 * figure, never in it.
 */
export function revenueByStream(input: {
  activeMembers: number;
  /** status 'paid', paid_at within this month. */
  paidThisMonth: RevenueInvoice[];
  /** status 'issued' — raised and not yet paid, of any date. */
  unpaid: RevenueInvoice[];
}) {
  const membership = input.activeMembers * MEMBERSHIP_MONTHLY_PENNIES;
  let advertising = 0;
  let featured = 0;
  for (const inv of input.paidThisMonth) {
    if (!ADVERTISING_INVOICE.test(inv.number)) continue;
    if (inv.placementKind === "featured_member") featured += inv.amountPennies;
    else advertising += inv.amountPennies;
  }
  const outstanding = input.unpaid
    .filter((inv) => ADVERTISING_INVOICE.test(inv.number))
    .reduce((sum, inv) => sum + inv.amountPennies, 0);
  return { membership, advertising, featured, total: membership + advertising + featured, outstanding };
}

export function pounds(pennies: number): string {
  return `£${Math.round(pennies / 100).toLocaleString("en-GB")}`;
}

/**
 * The range a price can take. Every priced run, slot and bundle is paid online
 * through Stripe Checkout (src/lib/advert-payments.ts), so the bounds are
 * Stripe's for a GBP charge: at least 30p, and at most 99,999,999p (£999,999.99,
 * the eight-digit `unit_amount` limit) — which also sits well inside the int
 * columns the price lands in (price_pennies, invoices.amount_pennies). Zero is
 * allowed and means "free": nothing is invoiced or held for it.
 */
export const PRICE_MIN_PENNIES = 30;
export const PRICE_MAX_PENNIES = 99_999_999;

/** Pounds with optional £, thousands commas in the right places, and at most two decimal places. */
const POUNDS_RE = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * A "Price (£)" form field → whole pennies. Blank is null (unpriced — Jas
 * invoices by hand); anything else that isn't a plain pounds amount inside the
 * range above is "invalid" so the action can say so, rather than storing NaN,
 * a negative invoice, or a price Stripe would refuse at checkout.
 *
 * Parsed as text, not with Number(): Number() reads "1e5", "0x10" and
 * "Infinity" as amounts, and float multiplication turned "12.345" into 1234.
 * Here the pounds and pence are separate integer strings, so 12.34 is exactly
 * 1234 and a third decimal place is refused rather than rounded.
 */
export function penniesFromPounds(raw: FormDataEntryValue | null): number | null | "invalid" {
  const s = String(raw ?? "").trim().replace(/^£\s*/, "");
  if (!s) return null;
  const m = POUNDS_RE.exec(s);
  if (!m) return "invalid";
  const pounds = m[1].replace(/,/g, "").replace(/^0+(?=\d)/, "");
  // Longer than the maximum's 6 pound digits can't be in range; checked on the
  // string so a 400-digit paste never becomes an imprecise float.
  if (pounds.length > 6) return "invalid";
  const pennies = Number(pounds) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (pennies === 0) return 0;
  if (pennies < PRICE_MIN_PENNIES || pennies > PRICE_MAX_PENNIES) return "invalid";
  return pennies;
}
