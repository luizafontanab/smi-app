/**
 * How long a member stays in `grace` — page still live — before the
 * `membership_lapse` job moves them to `lapsed` and their page is hidden.
 *
 * One window for every path into grace: a failed card payment
 * (`applyPaymentFailure`) and an expired promo comp (`comp_expiry` in jobs.ts).
 * Thirty days is a working assumption, not a confirmed rule — USE-CASES gap 5,
 * issue #8. Change it here once Jas confirms.
 */
export const GRACE_PERIOD_DAYS = 30;

/**
 * The `grace_until` date for a grace period starting on `day` (YYYY-MM-DD).
 * Anchored at noon UTC so adding days never slips across a date boundary.
 */
export function graceUntilFrom(day: string): string {
  const until = new Date(`${day}T12:00:00Z`);
  until.setUTCDate(until.getUTCDate() + GRACE_PERIOD_DAYS);
  return until.toISOString().slice(0, 10);
}
