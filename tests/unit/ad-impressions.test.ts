import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { reportAdSeen as ReportAdSeen } from "@/lib/ad-impressions";

/**
 * The pending/timer/listening state in ad-impressions.ts lives at module
 * scope, so each test needs its own fresh module instance rather than
 * sharing one across the file.
 */
async function freshModule() {
  vi.resetModules();
  const mod = await import("@/lib/ad-impressions");
  return mod.reportAdSeen;
}

describe("reportAdSeen", () => {
  let reportAdSeen: typeof ReportAdSeen;
  let sendBeacon: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    reportAdSeen = await freshModule();
    sendBeacon = vi.fn().mockReturnValue(true);
    // @ts-expect-error test-only stub; jsdom-free Node has no sendBeacon
    navigator.sendBeacon = sendBeacon;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  });

  afterEach(() => {
    // @ts-expect-error undo the stub added in beforeEach
    delete navigator.sendBeacon;
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it("does not send before the batch window elapses", async () => {
    reportAdSeen("ad-1", "/news");
    await vi.advanceTimersByTimeAsync(499);

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("batches ids reported within the window into a single beacon", async () => {
    reportAdSeen("ad-1", "/news");
    reportAdSeen("ad-2", "/video");
    await vi.advanceTimersByTimeAsync(500);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe("/api/seen");
    expect(JSON.parse(await blob.text())).toEqual({ items: [{ id: "ad-1", path: "/news" }, { id: "ad-2", path: "/video" }] });
  });

  it("dedupes repeated ids within the same batch", async () => {
    reportAdSeen("ad-1", "/news");
    reportAdSeen("ad-1", "/news");
    await vi.advanceTimersByTimeAsync(500);

    const [, blob] = sendBeacon.mock.calls[0];
    expect(JSON.parse(await blob.text())).toEqual({ items: [{ id: "ad-1", path: "/news" }] });
  });

  it("starts a new batch after the previous one flushes", async () => {
    reportAdSeen("ad-1", "/news");
    await vi.advanceTimersByTimeAsync(500);
    reportAdSeen("ad-2", "/video");
    await vi.advanceTimersByTimeAsync(500);

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await sendBeacon.mock.calls[1][1].text())).toEqual({ items: [{ id: "ad-2", path: "/video" }] });
  });

  it("falls back to a keepalive fetch when sendBeacon is unavailable", async () => {
    // @ts-expect-error remove the stub for this test
    delete navigator.sendBeacon;

    reportAdSeen("ad-1", "/news");
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/seen");
    expect(init?.method).toBe("POST");
    expect(init?.keepalive).toBe(true);
    expect(JSON.parse(init?.body as string)).toEqual({ items: [{ id: "ad-1", path: "/news" }] });
  });

  it("falls back to fetch when the browser refuses to queue the beacon", async () => {
    sendBeacon.mockReturnValue(false);

    reportAdSeen("ad-1", "/news");
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws when the fallback fetch itself fails", async () => {
    // @ts-expect-error remove the stub for this test
    delete navigator.sendBeacon;
    fetchSpy.mockRejectedValue(new Error("offline"));

    reportAdSeen("ad-1", "/news");
    await expect(vi.advanceTimersByTimeAsync(500)).resolves.not.toThrow();
  });
});
