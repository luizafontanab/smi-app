import { describe, expect, it } from "vitest";
import { ADVERT_FORMAT_PENNIES, FEATURED_SLOTS, MEMBERSHIP_MONTHLY_PENNIES, pounds, revenueByStream } from "@/lib/pricing";

describe("revenueByStream", () => {
  it("prices bookings by bundle when set, else by format default", () => {
    const r = revenueByStream({
      activeMembers: 0,
      liveBookings: [
        { format: "banner", bundlePennies: 100000 },
        { format: "banner", bundlePennies: null },
        { format: "supplier_logo", bundlePennies: null },
        { format: "unknown_format", bundlePennies: null },
      ],
      featuredSold: 0,
    });
    expect(r.advertising).toBe(100000 + ADVERT_FORMAT_PENNIES.banner + ADVERT_FORMAT_PENNIES.supplier_logo);
  });

  it("sums the three streams into the total", () => {
    const r = revenueByStream({
      activeMembers: 78,
      liveBookings: [{ format: "banner", bundlePennies: null }],
      featuredSold: 2,
    });
    expect(r.membership).toBe(78 * MEMBERSHIP_MONTHLY_PENNIES);
    expect(r.featured).toBe(2 * FEATURED_SLOTS.pennies);
    expect(r.total).toBe(r.membership + r.advertising + r.featured);
  });

  it("formats pennies as whole pounds", () => {
    expect(pounds(4000)).toBe("£40");
    expect(pounds(962000)).toBe("£9,620");
  });
});
