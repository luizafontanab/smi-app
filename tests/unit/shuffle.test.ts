import { describe, expect, it } from "vitest";
import { seededRand, seededShuffle } from "@/lib/shuffle";

// Seed strings shaped like memberDirectory's real ones: UTC day | category | q.
const items = Array.from({ length: 30 }, (_, i) => i);

describe("seededShuffle", () => {
  it("is deterministic — the same seed always yields the same permutation", () => {
    expect(seededShuffle(items, "2026-09-03||")).toEqual(seededShuffle(items, "2026-09-03||"));
    expect(seededShuffle(items, "2026-09-03|fabrication|laser")).toEqual(seededShuffle(items, "2026-09-03|fabrication|laser"));
  });

  it("differs across seeds — a new day or filter reshuffles", () => {
    const seeds = ["2026-09-03||", "2026-09-04||", "2026-09-03|fabrication|", "2026-09-03||welding"];
    const orders = seeds.map((s) => seededShuffle(items, s).join(","));
    // 30! possible orders — any collision here means the seed is being ignored.
    expect(new Set(orders).size).toBe(seeds.length);
  });

  it("returns a permutation and leaves the input untouched", () => {
    const input = [...items];
    const out = seededShuffle(input, "any-seed");
    expect(input).toEqual(items); // no mutation
    expect(out).not.toBe(input); // a copy, same as uniformShuffle
    expect([...out].sort((a, b) => a - b)).toEqual(items); // same elements, each exactly once
  });

  it("handles the degenerate sizes pagination can produce", () => {
    expect(seededShuffle([], "seed")).toEqual([]);
    expect(seededShuffle(["only"], "seed")).toEqual(["only"]);
  });
});

describe("seededRand", () => {
  it("emits numbers in [0, 1) and streams identically for the same seed", () => {
    const a = seededRand("seed");
    const b = seededRand("seed");
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(b()).toBe(v);
    }
  });
});
