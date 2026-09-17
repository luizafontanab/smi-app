import { describe, expect, it } from "vitest";
import { AD_FORMAT_KEYS, DEFAULT_AD_FORMATS } from "@/lib/advert-formats";

describe("DEFAULT_AD_FORMATS", () => {
  it("has exactly one entry per key in AD_FORMAT_KEYS, in order", () => {
    expect(DEFAULT_AD_FORMATS.map((f) => f.key)).toEqual([...AD_FORMAT_KEYS]);
  });

  it("gives every format a non-empty name and detail", () => {
    for (const format of DEFAULT_AD_FORMATS) {
      expect(format.name.length).toBeGreaterThan(0);
      expect(format.detail.length).toBeGreaterThan(0);
    }
  });
});
