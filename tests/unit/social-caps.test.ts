import { describe, expect, it } from "vitest";
import { DEFAULT_SOCIAL_CAPS } from "@/lib/social-caps";

describe("DEFAULT_SOCIAL_CAPS", () => {
  it("has a positive per_day and a non-negative delay_minutes", () => {
    expect(DEFAULT_SOCIAL_CAPS.per_day).toBeGreaterThan(0);
    expect(DEFAULT_SOCIAL_CAPS.delay_minutes).toBeGreaterThanOrEqual(0);
  });
});
