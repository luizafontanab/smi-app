import { describe, expect, it } from "vitest";
import { dealSlots, resolveAdvertTarget, uniformShuffle, type LiveAdvert } from "@/lib/adverts";

const ad = (i: number): LiveAdvert => ({
  advertId: `ad-${i}`,
  name: `Advert ${i}`,
  desktopPath: "d",
  mobilePath: "m",
  linkUrl: null,
  memberSlug: `member-${i}`,
  memberId: `mid-${i}`,
});

describe("rotation neutrality (the contractual rule: no advertiser can be favoured)", () => {
  it("every advert has a statistically equal chance of the first position", () => {
    const pool = Array.from({ length: 8 }, (_, i) => ad(i));
    const runs = 20_000;
    const firstCounts = new Map<string, number>();
    for (let r = 0; r < runs; r++) {
      const first = uniformShuffle(pool)[0].advertId;
      firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
    }
    const expected = runs / pool.length; // 2500
    for (const advert of pool) {
      const count = firstCounts.get(advert.advertId) ?? 0;
      // ±10% tolerance — generous for 20k runs; catches any systematic bias
      expect(count).toBeGreaterThan(expected * 0.9);
      expect(count).toBeLessThan(expected * 1.1);
    }
  });

  it("no bias input exists: shuffle output depends only on the RNG, never advert fields", () => {
    const pool = [ad(1), ad(2), ad(3)];
    const fixed = () => 0.42;
    const a = uniformShuffle(pool, fixed).map((x) => x.advertId);
    const renamed = pool.map((p) => ({ ...p, name: "BUY-TOP-SLOT-£££" }));
    const b = uniformShuffle(renamed, fixed).map((x) => x.advertId);
    expect(a).toEqual(b);
  });
});

describe("dealSlots", () => {
  it("fills every slot and never repeats an advert on the page until the pool is exhausted", () => {
    const pool = Array.from({ length: 8 }, (_, i) => ad(i));
    const slots = dealSlots(pool, ["home_1", "home_2", "home_3", "siderail_a", "siderail_b"]);
    const primaries = [...slots.values()].map((v) => v[0].advertId);
    expect(new Set(primaries).size).toBe(5); // 8 adverts, 5 slots → all primaries distinct
    for (const bucket of slots.values()) {
      expect(bucket.length).toBeGreaterThan(0);
      expect(bucket.length).toBeLessThanOrEqual(3);
    }
  });

  it("handles fewer adverts than slots without duplicating within a slot", () => {
    const pool = [ad(1), ad(2)];
    const slots = dealSlots(pool, ["a", "b", "c"]);
    for (const bucket of slots.values()) {
      const ids = bucket.map((x) => x.advertId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("returns empty buckets for an empty pool (page renders without adverts)", () => {
    const slots = dealSlots([], ["a", "b"]);
    expect([...slots.values()].every((v) => v.length === 0)).toBe(true);
  });
});

describe("advert click target", () => {
  it("explicit link wins; falls back to the member page (clicks register on their charts)", () => {
    expect(resolveAdvertTarget("https://x.co.uk", "acme")).toBe("https://x.co.uk");
    expect(resolveAdvertTarget(null, "acme")).toBe("/members/acme");
    expect(resolveAdvertTarget(null, null)).toBe("/");
  });
});
