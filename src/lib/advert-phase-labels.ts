import type { bookingPhase } from "./adverts";

/**
 * How a member sees each phase of an advert run. Shared by the advertising
 * hub's Manage and Assets tabs (GAPS A9.8) so the same run can't read
 * "scheduled" on one tab and something else on the next — the drift
 * components/console/advert-formats.ts was created to end on the console side.
 */
export const MEMBER_ADVERT_PHASE: Record<ReturnType<typeof bookingPhase>, { label: string; className: string }> = {
  draft: { label: "draft, not sent", className: "text-graphite" },
  awaiting: { label: "awaiting approval", className: "text-brand-text" },
  changes_needed: { label: "needs a change", className: "text-danger" },
  awaiting_payment: { label: "approved — payment due", className: "text-brand-text" },
  upcoming: { label: "scheduled", className: "text-graphite" },
  live: { label: "live now", className: "text-success" },
  ended: { label: "ended — run it again?", className: "text-graphite" },
};
