import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_MONTHLY_PENNIES, PRICE_MAX_PENNIES, PRICE_MIN_PENNIES, penniesFromPounds, pounds, revenueByStream,
} from "@/lib/pricing";

describe("revenueByStream", () => {
  const inv = (number: string, amountPennies: number, placementKind: string | null = null) => ({ number, amountPennies, placementKind });
  const none = { activeMembers: 0, paidThisMonth: [], unpaid: [] };

  // The review finding: bundle parts carry no price (20261016000033), and the
  // old sum over live bookings counted each at a per-format rate while never
  // reading the bundle's own price. The bundle's one invoice is what was billed.
  it("counts a bundle once, at the price it was invoiced for — not per part", () => {
    const r = revenueByStream({ ...none, paidThisMonth: [inv("SMI-ADV-MG3K2Q7F-4K9Z", 48000)] });
    expect(r.advertising).toBe(48000);
  });

  it("splits Featured Member slots from advertising, and counts a takeover as advertising", () => {
    const r = revenueByStream({
      ...none,
      paidThisMonth: [
        inv("SMI-ADV-A-0001", 65000),
        inv("SMI-ADV-A-0002", 35000, "featured_member"),
        inv("SMI-ADV-A-0003", 120000, "takeover"),
        inv("SMI-VIS-A-0004", 25000),
      ],
    });
    expect(r.advertising).toBe(65000 + 120000 + 25000);
    expect(r.featured).toBe(35000);
  });

  it("leaves membership invoices out — that stream is active members × the monthly rate, not added on top", () => {
    const r = revenueByStream({
      activeMembers: 3,
      paidThisMonth: [inv("SMI-JOIN-MG3K2Q7F-AAAA", 4000), inv("SMI-2026-101", 4000)],
      unpaid: [inv("SMI-2026-100", 4000)],
    });
    expect(r.membership).toBe(3 * MEMBERSHIP_MONTHLY_PENNIES);
    expect(r.advertising).toBe(0);
    expect(r.featured).toBe(0);
    expect(r.outstanding).toBe(0);
    expect(r.total).toBe(3 * MEMBERSHIP_MONTHLY_PENNIES);
  });

  it("shows invoiced-but-unpaid advertising as outstanding, never in the total", () => {
    const r = revenueByStream({
      activeMembers: 0,
      paidThisMonth: [inv("SMI-ADV-A-0001", 65000)],
      unpaid: [inv("SMI-ADV-A-0002", 48000), inv("SMI-ADV-A-0003", 40000, "featured_member")],
    });
    expect(r.outstanding).toBe(88000);
    expect(r.total).toBe(65000);
  });

  it("is nothing at all with nothing paid — no invented rate for live, unpriced runs", () => {
    const r = revenueByStream(none);
    expect(r).toEqual({ membership: 0, advertising: 0, featured: 0, total: 0, outstanding: 0 });
  });

  it("sums the three streams into the total", () => {
    const r = revenueByStream({
      activeMembers: 78,
      paidThisMonth: [inv("SMI-ADV-A-0001", 65000), inv("SMI-ADV-A-0002", 40000, "featured_member")],
      unpaid: [],
    });
    expect(r.total).toBe(78 * MEMBERSHIP_MONTHLY_PENNIES + 65000 + 40000);
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
    expect(penniesFromPounds("£")).toBeNull(); // a lone sign is still blank
  });

  it("flags anything that isn't a non-negative amount", () => {
    expect(penniesFromPounds("six hundred")).toBe("invalid");
    expect(penniesFromPounds("-5")).toBe("invalid");
    expect(penniesFromPounds("Infinity")).toBe("invalid");
  });

  // Review finding 9: Number() accepted these as amounts.
  it("refuses number forms that aren't plain pounds", () => {
    expect(penniesFromPounds("1e5")).toBe("invalid");
    expect(penniesFromPounds("0x10")).toBe("invalid");
    expect(penniesFromPounds("0b11")).toBe("invalid");
    expect(penniesFromPounds("+650")).toBe("invalid");
    expect(penniesFromPounds("650.")).toBe("invalid");
    expect(penniesFromPounds(".5")).toBe("invalid");
    expect(penniesFromPounds("6 50")).toBe("invalid");
  });

  it("only accepts commas as thousands separators", () => {
    expect(penniesFromPounds("1,250")).toBe(125000);
    expect(penniesFromPounds("12,345,678")).toBe("invalid"); // over the maximum, but well-formed
    expect(penniesFromPounds("1,25")).toBe("invalid");
    expect(penniesFromPounds("1,2,5,0")).toBe("invalid");
    expect(penniesFromPounds(",650")).toBe("invalid");
  });

  it("refuses a third decimal place rather than rounding it away", () => {
    expect(penniesFromPounds("12.345")).toBe("invalid");
    expect(penniesFromPounds("12.34")).toBe(1234);
    expect(penniesFromPounds("0.29")).toBe("invalid");
  });

  it("does the arithmetic exactly — no float drift", () => {
    // 1.15 * 100 is 114.99999999999999 in floating point; 0.57 * 100 is 56.99999999999999
    expect(penniesFromPounds("1.15")).toBe(115);
    expect(penniesFromPounds("0.57")).toBe(57);
    expect(penniesFromPounds("4,503.03")).toBe(450303);
    expect(penniesFromPounds("007.50")).toBe(750);
  });

  it("keeps a price inside what Stripe will take for GBP: 30p to £999,999.99, or free", () => {
    expect(penniesFromPounds("0.30")).toBe(PRICE_MIN_PENNIES);
    expect(penniesFromPounds("0.10")).toBe("invalid");
    expect(penniesFromPounds("0.00")).toBe(0);
    expect(penniesFromPounds("999,999.99")).toBe(PRICE_MAX_PENNIES);
    expect(penniesFromPounds("1000000")).toBe("invalid");
    expect(penniesFromPounds("9".repeat(400))).toBe("invalid");
  });
});
