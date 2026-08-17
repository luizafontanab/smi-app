import { describe, expect, it } from "vitest";
import { withinLimit, MINUTE } from "@/lib/rate-limit";

/**
 * The pure half of the limiter. callerKey/allowRequest need a request scope
 * (headers()), so they are exercised by the e2e suite instead — what matters
 * here is that the window arithmetic is right, since getting it wrong either
 * locks out real users or lets a flood through.
 */
describe("withinLimit", () => {
  it("allows exactly `limit` attempts, then refuses", () => {
    const key = `test:allow-${Math.random()}`;
    expect(withinLimit(key, 3, MINUTE)).toBe(true);
    expect(withinLimit(key, 3, MINUTE)).toBe(true);
    expect(withinLimit(key, 3, MINUTE)).toBe(true);
    expect(withinLimit(key, 3, MINUTE)).toBe(false);
  });

  it("keeps separate callers in separate buckets", () => {
    const a = `test:a-${Math.random()}`;
    const b = `test:b-${Math.random()}`;
    expect(withinLimit(a, 1, MINUTE)).toBe(true);
    expect(withinLimit(a, 1, MINUTE)).toBe(false);
    // b must be unaffected by a exhausting its budget
    expect(withinLimit(b, 1, MINUTE)).toBe(true);
  });

  it("starts a fresh window once the old one has expired", () => {
    const key = `test:window-${Math.random()}`;
    // a zero-length window is already expired on the next call
    expect(withinLimit(key, 1, 0)).toBe(true);
    expect(withinLimit(key, 1, 0)).toBe(true);
  });

  it("stays refused for the rest of the window, not just the first time over", () => {
    const key = `test:sticky-${Math.random()}`;
    expect(withinLimit(key, 1, MINUTE)).toBe(true);
    expect(withinLimit(key, 1, MINUTE)).toBe(false);
    expect(withinLimit(key, 1, MINUTE)).toBe(false);
  });
});
