import { bookingPhase } from "./adverts";

/**
 * Which card a sold item sits in on the Banners, Supplier Logos, Featured
 * Member, Takeover and Bundles pages — the same three for all of them:
 *
 * - `booked`  confirmed and still to run or running: paid (or unpriced) and approved
 * - `pending` not confirmed yet: waiting on Jas's approval, the member's
 *             changes, or the member's payment
 * - `past`    finished, or called off — counted, linked, not listed
 *
 * Pure, so the three pages can't disagree and it unit-tests without a page.
 */
export type BookingGroup = "booked" | "pending" | "past";

type Run = { status: string; starts_on: string; ends_on: string };

export function runGroup(run: Run, today: string): BookingGroup {
  switch (bookingPhase(run, today)) {
    case "live":
    case "upcoming":
      return "booked";
    case "awaiting":
    case "awaiting_payment":
    case "changes_needed":
    case "draft":
      return "pending";
    default:
      return "past";
  }
}

/** What a pending run is waiting on, in Jas's words. Null for anything not pending. */
export function pendingReason(run: Run, today: string): string | null {
  switch (bookingPhase(run, today)) {
    case "awaiting": return "needs your approval";
    case "awaiting_payment": return "waiting for payment";
    case "changes_needed": return "waiting for the member's changes";
    case "draft": return "draft, not submitted";
    default: return null;
  }
}

type Placement = { awaiting_payment: boolean; ends_on: string };

/** Placements have no status or approval step — only the payment hold and the dates. */
export function placementGroup(p: Placement, today: string): BookingGroup {
  if (p.ends_on < today) return "past";
  return p.awaiting_payment ? "pending" : "booked";
}

/**
 * A bundle is pending until it has parts and none of them is waiting on
 * anything; past once every part has finished.
 */
export function bundleGroup(parts: Run[], today: string): BookingGroup {
  if (!parts.length) return "pending";
  const groups = parts.map((p) => runGroup(p, today));
  if (groups.includes("pending")) return "pending";
  return groups.includes("booked") ? "booked" : "past";
}

/**
 * Whether a bundle has a part on the site today. Not "any part has started":
 * a part that has already ended, or one still held for payment, isn't live,
 * and the Bundles page used to badge such a bundle "live" all the same.
 */
export function bundleLive(parts: Run[], today: string): boolean {
  return parts.some((p) => bookingPhase(p, today) === "live");
}

export function groupBy<T>(items: T[], group: (item: T) => BookingGroup): Record<BookingGroup, T[]> {
  const out: Record<BookingGroup, T[]> = { booked: [], pending: [], past: [] };
  for (const item of items) out[group(item)].push(item);
  return out;
}
