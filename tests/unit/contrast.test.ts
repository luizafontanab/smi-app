import { describe, expect, it } from "vitest";
import { contrastRatio, meetsWcagAA, relativeLuminance } from "@/lib/contrast";

describe("relativeLuminance", () => {
  it("black is 0, white is 1 — the ends of the WCAG scale", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("black on white is the maximum, 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("a colour against itself is the minimum, 1:1", () => {
    expect(contrastRatio("#fe5000", "#fe5000")).toBeCloseTo(1, 5);
  });

  it("is symmetric — argument order never changes the answer", () => {
    expect(contrastRatio("#fe5000", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#fe5000"), 10);
  });

  it("accepts hex with or without a leading #", () => {
    expect(contrastRatio("fe5000", "ffffff")).toBeCloseTo(contrastRatio("#fe5000", "#ffffff"), 10);
  });
});

describe("meetsWcagAA", () => {
  it("matches the app's own documented pairing (globals.css): ink on brand is 4.7:1, passes normal text", () => {
    expect(meetsWcagAA("#111418", "#fe5000")).toBe(true);
  });

  it("matches the app's own documented failure: brand on white is 3.3:1 — fails normal text, passes large text", () => {
    expect(meetsWcagAA("#fe5000", "#ffffff")).toBe(false);
    expect(meetsWcagAA("#fe5000", "#ffffff", { largeText: true })).toBe(true);
  });

  it("matches the documented small-label pairings: brand-text on paper and brand on ink both pass normal text", () => {
    expect(meetsWcagAA("#c84000", "#ffffff")).toBe(true);
    expect(meetsWcagAA("#fe5000", "#111418")).toBe(true);
  });

  it("matches the semantic status tokens: danger and success pass normal text on paper, and white on both", () => {
    expect(meetsWcagAA("#b91c1c", "#ffffff")).toBe(true);
    expect(meetsWcagAA("#15803d", "#ffffff")).toBe(true);
    expect(meetsWcagAA("#ffffff", "#b91c1c")).toBe(true);
    expect(meetsWcagAA("#ffffff", "#15803d")).toBe(true);
  });

  it("rejects a malformed hex rather than silently treating it as black", () => {
    expect(() => meetsWcagAA("not-a-colour", "#ffffff")).toThrow();
  });
});
