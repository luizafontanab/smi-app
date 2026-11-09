import type { MembershipChangeFailure } from "@/lib/membership";

/**
 * Admin-facing wording for the console's Cancel membership section (#90), in
 * one place so the page, the action and #92's undo all say the same thing.
 * The membership module states only a reason (`MembershipChangeFailure`);
 * this turns it into what an admin should do next. Keyed by the change being
 * made — #92 adds an `undo` entry beside `cancel`.
 *
 * Not in actions.ts: that file is "use server", where every export must be an
 * async server action.
 */
const FAILURE_MESSAGES = {
  cancel: {
    not_found: "That member no longer exists.",
    no_subscription:
      "This member's subscription wasn't created by this site, so it can't be cancelled here. Cancel it in Stripe; the membership will end when Stripe reports it.",
    period_ended: "This membership's paid period has already ended, so there is nothing left to cancel.",
  },
} as const;

export type MembershipChange = keyof typeof FAILURE_MESSAGES;

/** The message for a failed change. Stripe's refusal is shown as Stripe worded it. */
export function membershipFailureMessage(change: MembershipChange, failure: MembershipChangeFailure): string {
  return failure.reason === "stripe_rejected" ? failure.detail : FAILURE_MESSAGES[change][failure.reason];
}

/** Invoice-billing members have no card subscription to stop. Shown in place of any action. */
export const INVOICE_BILLING_LINE = "Invoice billing: stop raising invoices by hand.";

/** Draft and lapsed members get no section; this is only reached by a direct POST. */
export const NOT_CANCELLABLE = "Only an active or grace member who pays by card can be cancelled here.";

export const CONFIRM_CANCEL = "Tick the box to confirm — cancelling stops their membership renewing.";

/** `iso` as "8 Nov 2026", London time — the date a cancel was scheduled. */
export function scheduledOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
}
