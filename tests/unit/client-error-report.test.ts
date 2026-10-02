// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isNoise, reportClientError, resetClientErrorReports } from "@/lib/client-error-report";

const beacon = vi.fn(() => true);

beforeEach(() => {
  Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
});
afterEach(() => {
  resetClientErrorReports();
  beacon.mockClear();
  beacon.mockReturnValue(true);
  vi.unstubAllGlobals();
});

describe("reportClientError (docs/logging.md)", () => {
  it("beacons a report with the page path", async () => {
    reportClientError({ message: "boom", stack: "Error: boom", kind: "error" });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/api/client-errors");
    expect(JSON.parse(await blob.text())).toMatchObject({ message: "boom", kind: "error", path: "/" });
  });

  it("reports the same message once per page load, and at most five in all", () => {
    reportClientError({ message: "same", kind: "error" });
    reportClientError({ message: "same", kind: "error" });
    expect(beacon).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) reportClientError({ message: `m${i}`, kind: "error" });
    expect(beacon).toHaveBeenCalledTimes(5);
  });

  it("drops noise nobody can fix", () => {
    expect(isNoise("x", "at chrome-extension://abc/content.js:1")).toBe(true);
    expect(isNoise("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isNoise("Script error.", null)).toBe(true);
    expect(isNoise("TypeError: x is undefined", "at /_next/static/chunks/a.js")).toBe(false);
    reportClientError({ message: "Script error.", kind: "error" });
    expect(beacon).not.toHaveBeenCalled();
  });

  it("falls back to a keepalive fetch when the beacon is refused", () => {
    beacon.mockReturnValue(false);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    reportClientError({ message: "boom", kind: "boundary", digest: "123" });
    expect(fetchMock).toHaveBeenCalledWith("/api/client-errors", expect.objectContaining({ method: "POST", keepalive: true }));
  });

  it("never throws", () => {
    beacon.mockImplementation(() => { throw new Error("blocked"); });
    expect(() => reportClientError({ message: "boom", kind: "error" })).not.toThrow();
  });
});
