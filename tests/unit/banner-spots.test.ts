import { describe, expect, it } from "vitest";
import { DEFAULT_BANNER_SPOTS, resolveBannerSpots } from "@/lib/banner-spots";

describe("resolveBannerSpots", () => {
  it("reads the stored count", () => {
    expect(resolveBannerSpots({ count: 6 })).toBe(6);
  });

  it("falls back to 8 for a missing or malformed row — never zero, which would read as sold out", () => {
    expect(DEFAULT_BANNER_SPOTS).toBe(8);
    for (const value of [null, undefined, {}, { count: 0 }, { count: -1 }, { count: 2.5 }, { count: "8" }, "8"]) {
      expect(resolveBannerSpots(value), JSON.stringify(value)).toBe(8);
    }
  });
});
