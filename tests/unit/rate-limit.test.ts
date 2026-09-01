import { afterEach, describe, expect, it, vi } from "vitest";
import { allowRequest, callerKey, withinLimit, MINUTE } from "@/lib/rate-limit";
import { headers, requestHeaders, resetNextHeadersMocks } from "../stubs/next-headers";

afterEach(() => {
  resetNextHeadersMocks();
  vi.restoreAllMocks();
});

/**
 * The pure half of the limiter — what matters here is that the window
 * arithmetic is right, since getting it wrong either locks out real users or
 * lets a flood through.
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

describe("callerKey", () => {
  it("keys by the first x-forwarded-for entry, trimmed", async () => {
    requestHeaders.set("x-forwarded-for", "203.0.113.5, 70.41.3.18");
    expect(await callerKey("join")).toBe("join:203.0.113.5");
  });

  it("falls back to 'local' with no forwarding header", async () => {
    expect(await callerKey("join")).toBe("join:local");
  });

  it("returns null rather than throwing when headers() has no request scope", async () => {
    vi.mocked(headers).mockRejectedValueOnce(new Error("no request scope"));
    expect(await callerKey("join")).toBeNull();
  });
});

describe("allowRequest", () => {
  it("delegates to withinLimit using the caller's key", async () => {
    requestHeaders.set("x-forwarded-for", `198.51.100.${Math.floor(Math.random() * 255)}`);
    expect(await allowRequest("contact", 1, MINUTE)).toBe(true);
    expect(await allowRequest("contact", 1, MINUTE)).toBe(false);
  });

  it("never blocks when there's no caller to attribute the limit to", async () => {
    vi.mocked(headers).mockRejectedValue(new Error("no request scope"));
    expect(await allowRequest("contact", 0, MINUTE)).toBe(true);
  });
});
