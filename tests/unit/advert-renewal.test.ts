import { describe, expect, it } from "vitest";
import { canRenewBooking, renewalDatesProblem } from "@/lib/advert-renewal";

// Review finding 16 Oct: renewAdvertBooking renewed an owned booking in any
// status and took whatever dates it was sent.
describe("canRenewBooking", () => {
  const today = "2026-10-16";
  const run = (status: string, starts_on = "2026-09-01", ends_on = "2026-09-30") => ({ status, starts_on, ends_on });

  it("only a finished run", () => {
    expect(canRenewBooking(run("ended"), today)).toBe(true);
    // scheduled/live past its term, before the sweep marks it ended — the page calls it ended too
    expect(canRenewBooking(run("live"), today)).toBe(true);
    expect(canRenewBooking(run("scheduled"), today)).toBe(true);
  });

  it.each(["draft", "awaiting_approval", "review_required", "awaiting_payment"])("never a %s run", (status) => {
    expect(canRenewBooking(run(status), today)).toBe(false);
  });

  it("never a run that is still running, or yet to start", () => {
    expect(canRenewBooking(run("live", "2026-10-01", "2026-10-31"), today)).toBe(false);
    expect(canRenewBooking(run("scheduled", "2026-11-01", "2026-11-30"), today)).toBe(false);
    expect(canRenewBooking(run("live", "2026-10-01", today), today)).toBe(false); // its last day
  });
});

describe("renewalDatesProblem", () => {
  const today = "2026-10-16";

  it("accepts real dates, in order, from today on", () => {
    expect(renewalDatesProblem("2026-10-16", "2026-10-16", today)).toBeNull();
    expect(renewalDatesProblem("2026-11-01", "2026-11-30", today)).toBeNull();
    expect(renewalDatesProblem("2028-02-29", "2028-03-01", today)).toBeNull(); // a leap day
  });

  it.each([
    ["", ""],
    ["2026-11-01", ""],
    ["01/11/2026", "30/11/2026"],
    ["2026-02-30", "2026-03-30"],
    ["2026-11-01T00:00", "2026-11-30"],
  ])("refuses %j → %j as not dates", (starts, ends) => {
    expect(renewalDatesProblem(starts, ends, today)).toBe("Choose a start and an end date for the new run.");
  });

  it("refuses a start in the past and an end before the start", () => {
    expect(renewalDatesProblem("2026-10-15", "2026-11-15", today)).toBe("The new run can't start in the past.");
    expect(renewalDatesProblem("2026-11-30", "2026-11-01", today)).toBe("The run must end on or after its start date.");
  });
});
