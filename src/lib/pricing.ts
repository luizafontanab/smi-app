// No price columns exist in the schema yet — the £40 join charge is the same
// hardcode in membership.ts applyPaymentResult(). Until Jas confirms real rates
// (then they belong in settings), this module is the single place they live.
export const MEMBERSHIP_MONTHLY_PENNIES = 4000;

export const FEATURED_SLOTS = { cap: 4, pennies: 40000 };

// Per-format fallback when a booking carries no bundle price.
export const ADVERT_FORMAT_PENNIES: Record<string, number> = {
  banner: 65000,
  supplier_logo: 10000,
};

export type LiveBooking = { format: string | null; productPennies: number | null };

export function revenueByStream(input: {
  activeMembers: number;
  liveBookings: LiveBooking[];
  featuredSold: number;
}) {
  const membership = input.activeMembers * MEMBERSHIP_MONTHLY_PENNIES;
  let advertising = 0;
  let unpriced = 0;
  for (const b of input.liveBookings) {
    const rate = b.productPennies ?? ADVERT_FORMAT_PENNIES[b.format ?? ""] ?? null;
    if (rate === null) unpriced++;
    else advertising += rate;
  }
  const featured = input.featuredSold * FEATURED_SLOTS.pennies;
  return { membership, advertising, featured, total: membership + advertising + featured, unpriced };
}

export function pounds(pennies: number): string {
  return `£${Math.round(pennies / 100).toLocaleString("en-GB")}`;
}
