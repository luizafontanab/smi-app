import { describe, expect, it } from "vitest";
import { graceUntilFrom } from "@/lib/grace-period";

/**
 * Issue #8 (GAPS D4, USE-CASES gap 5): one grace window, shared by a failed
 * card payment and an expired promo comp. Expected dates are worked by hand
 * for the current 30-day window — if Jas confirms a different length, these
 * literals change with it, deliberately.
 */
describe("graceUntilFrom", () => {
  it("ends the grace period thirty days after the start day", () => {
    expect(graceUntilFrom("2026-01-01")).toBe("2026-01-31");
  });

  it("rolls over a month and a year end", () => {
    expect(graceUntilFrom("2026-12-15")).toBe("2027-01-14");
  });

  it("lands on the right day across the spring clock change", () => {
    expect(graceUntilFrom("2026-03-20")).toBe("2026-04-19");
  });
});
