import { describe, expect, it } from "vitest";
import { ADVERT_FORMAT_PENNIES, FEATURED_SLOTS, MEMBERSHIP_MONTHLY_PENNIES, penniesFromPounds, pounds, revenueByStream } from "@/lib/pricing";

describe("revenueByStream", () => {
  it("prices bookings by their own price when set, else by format default", () => {
    const r = revenueByStream({
      activeMembers: 0,
      liveBookings: [
        { format: "banner", pricePennies: 100000 },
        { format: "banner", pricePennies: null },
        { format: "supplier_logo", pricePennies: null },
      ],
      featuredSold: 0,
    });
    expect(r.advertising).toBe(100000 + ADVERT_FORMAT_PENNIES.banner + ADVERT_FORMAT_PENNIES.supplier_logo);
    expect(r.unpriced).toBe(0);
  });

  it("counts bookings with no product rate and no format default as unpriced, not free", () => {
    const r = revenueByStream({
      activeMembers: 0,
      liveBookings: [
        { format: "skyscraper", pricePennies: null },
        { format: "mpu", pricePennies: 50000 },
      ],
      featuredSold: 0,
    });
    expect(r.advertising).toBe(50000);
    expect(r.unpriced).toBe(1);
  });

  it("sums the three streams into the total", () => {
    const r = revenueByStream({
      activeMembers: 78,
      liveBookings: [{ format: "banner", pricePennies: null }],
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

describe("penniesFromPounds", () => {
  it("reads pounds, with or without pence, a £ sign or thousands commas", () => {
    expect(penniesFromPounds("650")).toBe(65000);
    expect(penniesFromPounds("650.5")).toBe(65050);
    expect(penniesFromPounds(" £1,250.00 ")).toBe(125000);
    expect(penniesFromPounds("0")).toBe(0);
  });

  it("treats blank or missing as unpriced", () => {
    expect(penniesFromPounds("")).toBeNull();
    expect(penniesFromPounds("   ")).toBeNull();
    expect(penniesFromPounds(null)).toBeNull();
  });

  it("flags anything that isn't a non-negative amount", () => {
    expect(penniesFromPounds("six hundred")).toBe("invalid");
    expect(penniesFromPounds("-5")).toBe("invalid");
    expect(penniesFromPounds("Infinity")).toBe("invalid");
  });
});
