// No price columns exist in the schema yet — the £40 join charge is the same
// hardcode in membership.ts applyPaymentResult(). Until Jas confirms real rates
// (then they belong in settings), this module is the single place they live.
export const MEMBERSHIP_MONTHLY_PENNIES = 4000;

// cap raised 4 → 8 on 20 Sep, when the homepage box became a real rotating
// carousel: three are on screen at a time and the rest take their turn, so
// the eighth advertiser gets the same exposure as the first. Enforced only
// here and in console/actions.ts (no DB constraint), and read by the console
// dashboard's slot pips and the Featured Member page's copy.
export const FEATURED_SLOTS = { cap: 8, pennies: 40000 };

// Per-format fallback when a booking carries no price of its own.
export const ADVERT_FORMAT_PENNIES: Record<string, number> = {
  banner: 65000,
  // Same rate as a banner until Jas prices it: it is the same height and the
  // same position, just cut for a narrower column. Without an entry here a
  // banner_narrow booking with no price counts as `unpriced` and
  // quietly drops out of the console's revenue figure.
  banner_narrow: 65000,
  supplier_logo: 10000,
};

export type LiveBooking = { format: string | null; pricePennies: number | null };

export function revenueByStream(input: {
  activeMembers: number;
  liveBookings: LiveBooking[];
  featuredSold: number;
}) {
  const membership = input.activeMembers * MEMBERSHIP_MONTHLY_PENNIES;
  let advertising = 0;
  let unpriced = 0;
  for (const b of input.liveBookings) {
    const rate = b.pricePennies ?? ADVERT_FORMAT_PENNIES[b.format ?? ""] ?? null;
    if (rate === null) unpriced++;
    else advertising += rate;
  }
  const featured = input.featuredSold * FEATURED_SLOTS.pennies;
  return { membership, advertising, featured, total: membership + advertising + featured, unpriced };
}

export function pounds(pennies: number): string {
  return `£${Math.round(pennies / 100).toLocaleString("en-GB")}`;
}

/**
 * A "Price (£)" form field → whole pennies. Blank is null (unpriced — Jas
 * invoices by hand); anything that isn't a non-negative amount is "invalid"
 * so the action can say so, rather than storing NaN or a negative invoice.
 */
export function penniesFromPounds(raw: FormDataEntryValue | null): number | null | "invalid" {
  const s = String(raw ?? "").trim().replace(/^£/, "").replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n * 100);
}
