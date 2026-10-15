import { bookingPhase } from "@/lib/adverts";

/**
 * "Run it again" (dashboard/actions.ts renewAdvertBooking): the rules, kept
 * free of Next and Supabase so they unit-test with plain values, and shared
 * with the booking page so the form is offered exactly when the action will
 * accept it.
 *
 * Only a finished run is renewed — `bookingPhase` "ended", which is a booking
 * marked ended or a scheduled/live one whose term is over and the sweep
 * hasn't reached yet. Anything earlier in the lifecycle already has a way
 * forward: a draft or a sent-back run is resubmitted, one awaiting approval or
 * payment is with the desk, and an upcoming or live run is still running.
 * Renewing those just queued a second copy of the same request.
 */
export function canRenewBooking(booking: { status: string; starts_on: string; ends_on: string }, today: string): boolean {
  return bookingPhase(booking, today) === "ended";
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day in YYYY-MM-DD — what `<input type="date">` posts; "2026-02-30" is not one. */
function isCalendarDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Why the requested dates can't be booked, or null. `today` is the UTC day,
 * the same clock bookingPhase and the booking page use.
 */
export function renewalDatesProblem(startsOn: string, endsOn: string, today: string): string | null {
  if (!isCalendarDay(startsOn) || !isCalendarDay(endsOn)) return "Choose a start and an end date for the new run.";
  if (startsOn < today) return "The new run can't start in the past.";
  if (endsOn < startsOn) return "The run must end on or after its start date.";
  return null;
}
