import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "@/lib/site-url";

/**
 * The fallback chain is the whole point of this module. It used to end at the
 * live WordPress domain, so an unconfigured deploy published a sitemap of URLs
 * pointing at the old site — telling crawlers our content lived elsewhere.
 * Each step below is one link in the chain that replaced it.
 */

beforeEach(() => {
  // Cleared rather than assumed: .env.local sets SITE_URL on a dev machine,
  // and each case here needs to start from nothing.
  vi.stubEnv("SITE_URL", undefined);
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", undefined);
  vi.stubEnv("VERCEL_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl", () => {
  it("prefers an explicit SITE_URL", () => {
    vi.stubEnv("SITE_URL", "https://sheetmetalindustries.com");
    expect(siteUrl()).toBe("https://sheetmetalindustries.com");
  });

  it("trims whitespace and trailing slashes off SITE_URL", () => {
    // A trailing slash would double up against every path the callers append.
    vi.stubEnv("SITE_URL", "  https://smi.test///  ");
    expect(siteUrl()).toBe("https://smi.test");
  });

  it("falls back to the Vercel production host, adding the scheme it omits", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "smi.vercel.app");
    expect(siteUrl()).toBe("https://smi.vercel.app");
  });

  it("uses the per-deployment VERCEL_URL on a preview build", () => {
    vi.stubEnv("VERCEL_URL", "smi-git-staging.vercel.app");
    expect(siteUrl()).toBe("https://smi-git-staging.vercel.app");
  });

  it("prefers the stable production host over the per-deployment one", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "smi.vercel.app");
    vi.stubEnv("VERCEL_URL", "smi-git-staging.vercel.app");
    expect(siteUrl()).toBe("https://smi.vercel.app");
  });

  it("strips a scheme and trailing slashes if the Vercel host arrives with them", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "http://smi.vercel.app/");
    expect(siteUrl()).toBe("https://smi.vercel.app");
  });

  it("skips a blank host rather than emitting https:// with nothing after it", () => {
    vi.stubEnv("SITE_URL", "   ");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "  ");
    vi.stubEnv("VERCEL_URL", "");
    expect(siteUrl()).toBe("http://localhost:3100");
  });

  it("ends at localhost in dev", () => {
    expect(siteUrl()).toBe("http://localhost:3100");
  });
});
