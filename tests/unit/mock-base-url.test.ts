import { afterEach, describe, expect, it, vi } from "vitest";
import { mockBaseUrl } from "@/lib/adapters/mock-base-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * The Preview-only mock escape hatch, previously at 40%.
 *
 * Small, but it is a safety net rather than a feature: if it ever returned a
 * URL on a production deployment, the Stripe and Bigin adapters would silently
 * call this app's own /api/mock/* routes instead of the real vendors — real
 * members' payments and CRM writes going nowhere, with every call appearing to
 * succeed. The `VERCEL_ENV === "production"` check is the thing that must never
 * regress, so it gets an explicit test rather than being covered incidentally.
 */
describe("mockBaseUrl", () => {
  it("is off by default — an unset MOCK_INTEGRATIONS means the real vendors", () => {
    expect(mockBaseUrl()).toBeNull();
  });

  it("is off for any value other than exactly '1'", () => {
    for (const value of ["", "0", "true", "yes", "TRUE"]) {
      vi.stubEnv("MOCK_INTEGRATIONS", value);
      expect(mockBaseUrl(), value).toBeNull();
    }
  });

  it("returns a base URL when enabled outside production", () => {
    vi.stubEnv("MOCK_INTEGRATIONS", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(mockBaseUrl()).toBeTruthy();
  });

  it("refuses on a production deployment even when the flag is set — the safety net", () => {
    vi.stubEnv("MOCK_INTEGRATIONS", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(mockBaseUrl()).toBeNull();
  });

  it("allows development, so a local run can exercise the mock routes", () => {
    vi.stubEnv("MOCK_INTEGRATIONS", "1");
    vi.stubEnv("VERCEL_ENV", "development");
    expect(mockBaseUrl()).toBeTruthy();
  });

  it("allows an unset VERCEL_ENV — off-Vercel is never production here", () => {
    vi.stubEnv("MOCK_INTEGRATIONS", "1");
    vi.stubEnv("VERCEL_ENV", "");
    expect(mockBaseUrl()).toBeTruthy();
  });
});
