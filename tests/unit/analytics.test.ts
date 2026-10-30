import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsConsented, classifyReferrer, CONSENT_COOKIE, countryFromHeader, deviceFromUserAgent, newsletterClick, record, recordSearch, requestContext, sessionHash } from "@/lib/analytics";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { cookieStore, requestHeaders, resetNextHeadersMocks } from "../stubs/next-headers";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/adapters/company-resolver", () => ({
  resolveIp: vi.fn(async () => ({ region: "West Midlands", company: null })),
}));

afterEach(() => {
  resetDbServerMocks();
  resetNextHeadersMocks();
  vi.restoreAllMocks();
});

describe("analyticsConsented", () => {
  it("is false with no cookie at all — the banner hasn't been answered yet", async () => {
    expect(await analyticsConsented()).toBe(false);
  });

  it("is false for 'essential' — only an explicit 'all' counts", async () => {
    cookieStore.set(CONSENT_COOKIE, "essential");
    expect(await analyticsConsented()).toBe(false);
  });

  it("is true for 'all'", async () => {
    cookieStore.set(CONSENT_COOKIE, "all");
    expect(await analyticsConsented()).toBe(true);
  });
});

describe("record", () => {
  it("never touches the database when every event was recorded without consent", () => {
    record([{ kind: "page_view", path: "/news", consented: false }]);
    expect(vi.mocked(serviceDb)).not.toHaveBeenCalled();
  });

  it("drops declined events but inserts the rest, stripping the consented flag", () => {
    const builder = queryBuilder(dbOk(null));
    const from = vi.fn(() => builder);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    record([
      { kind: "page_view", path: "/news", consented: true },
      { kind: "page_view", path: "/private", consented: false },
    ]);

    expect(from).toHaveBeenCalledWith("analytics_events");
    expect(builder.insert).toHaveBeenCalledWith([{ kind: "page_view", path: "/news" }]);
  });

  it("logs rather than throws when the insert fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbError("insert failed")) })));

    record([{ kind: "ad_impression", advert_id: "ad1" }]);
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[analytics]"), "insert failed");
  });
});

describe("newsletterClick (GAPS B5.10)", () => {
  const consented = { session_hash: "h", referrer: "https://mail.example", region: "West Midlands", company: "Acme", device: "desktop" as const, country: "GB", consented: true };
  const declined = { session_hash: null, referrer: null, region: null, company: null, device: null, country: null, consented: false };

  it("keeps a consenting reader's full context", () => {
    expect(newsletterClick(consented, "newsletter")).toBe(consented);
  });

  it("leaves an ordinary visit without consent declined", () => {
    expect(newsletterClick(declined, null)).toBe(declined);
    expect(newsletterClick(declined, "elsewhere")).toBe(declined);
  });

  it("turns a newsletter click without consent into an anonymous, recordable one", () => {
    expect(newsletterClick(declined, "newsletter")).toEqual({ ...declined, anonymous: true });
  });

  it("never reads the reader's IP or browser for one", async () => {
    // No consent cookie: requestContext must return before resolving the IP.
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({})));
    const { resolveIp } = await import("@/lib/adapters/company-resolver");
    const ctx = newsletterClick(await requestContext(), "newsletter");
    expect(ctx).toEqual({ session_hash: null, referrer: null, region: null, company: null, device: null, country: null, consented: false, anonymous: true });
    expect(resolveIp).not.toHaveBeenCalled();
  });
});

describe("record — anonymous rows", () => {
  it("inserts an anonymous event with every identifier blanked, whatever was passed in", () => {
    const builder = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => builder })));

    record([{ kind: "ad_click", advert_id: "ad1", path: "newsletter", session_hash: "leaked", region: "X", company: "Y", referrer: "Z", device: "mobile", country: "GB", consented: false, anonymous: true }]);

    expect(builder.insert).toHaveBeenCalledWith([
      { kind: "ad_click", advert_id: "ad1", path: "newsletter", session_hash: null, region: null, company: null, referrer: null, device: null, country: null },
    ]);
  });
});

describe("recordSearch", () => {
  it("never touches the database when recorded without consent", () => {
    recordSearch({ query: "steel", results_count: 3, consented: false });
    expect(vi.mocked(serviceDb)).not.toHaveBeenCalled();
  });

  it("inserts only the search_queries columns, stripping the consented flag", () => {
    const builder = queryBuilder(dbOk(null));
    const from = vi.fn(() => builder);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    recordSearch({ query: "steel", results_count: 3, session_hash: "abc", consented: true });

    expect(from).toHaveBeenCalledWith("search_queries");
    expect(builder.insert).toHaveBeenCalledWith({ query: "steel", results_count: 3, session_hash: "abc" });
  });

  it("logs rather than throws when the insert fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbError("insert failed")) })));

    recordSearch({ query: "steel", results_count: 0 });
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[analytics]"), "insert failed");
  });
});

describe("classifyReferrer", () => {
  it("buckets no referrer as direct", () => {
    expect(classifyReferrer(null)).toBe("direct");
    expect(classifyReferrer(undefined)).toBe("direct");
  });

  it("buckets an unparseable referrer as other", () => {
    expect(classifyReferrer("not-a-url")).toBe("other");
  });

  it("buckets known AI product domains, including subdomains", () => {
    expect(classifyReferrer("https://chatgpt.com/c/abc")).toBe("ai");
    expect(classifyReferrer("https://www.perplexity.ai/search")).toBe("ai");
  });

  it("buckets search engines", () => {
    expect(classifyReferrer("https://www.google.com/search?q=smi")).toBe("search");
    expect(classifyReferrer("https://www.bing.com/search?q=smi")).toBe("search");
  });

  it("buckets social platforms", () => {
    expect(classifyReferrer("https://www.linkedin.com/feed")).toBe("social");
  });

  it("buckets everything else as other", () => {
    expect(classifyReferrer("https://example.com/some-page")).toBe("other");
  });
});

describe("requestContext", () => {
  // GAPS C6: requestContext() now bumps the consent-rate counter on every
  // call, consented or not — needs a serviceDb().rpc() to land on.
  beforeEach(() => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb()));
  });

  it("returns the declined context without reading headers when not consented", async () => {
    const context = await requestContext();
    expect(context).toEqual({ session_hash: null, referrer: null, region: null, company: null, device: null, country: null, consented: false });
  });

  it("never reads the country header without consent", async () => {
    requestHeaders.set("x-vercel-ip-country", "GB");
    requestHeaders.set("user-agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148");
    const context = await requestContext();
    expect(context.country).toBeNull();
    expect(context.device).toBeNull();
  });

  it("records device category and country when consented", async () => {
    cookieStore.set(CONSENT_COOKIE, "all");
    requestHeaders.set("user-agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148");
    requestHeaders.set("x-vercel-ip-country", "gb");
    const context = await requestContext();
    expect(context.device).toBe("mobile");
    expect(context.country).toBe("GB");
  });

  it("leaves country null when the edge header is absent (local dev)", async () => {
    cookieStore.set(CONSENT_COOKIE, "all");
    const context = await requestContext();
    expect(context.country).toBeNull();
    expect(context.device).toBe("desktop");
  });

  it("builds attribution from the request when consented", async () => {
    cookieStore.set(CONSENT_COOKIE, "all");
    requestHeaders.set("x-forwarded-for", "203.0.113.5, 70.41.3.18");
    requestHeaders.set("user-agent", "Mozilla/5.0 Test");
    requestHeaders.set("referer", "https://example.com/prior-page");

    const context = await requestContext();

    expect(context.consented).toBe(true);
    expect(context.referrer).toBe("https://example.com/prior-page");
    expect(context.region).toBe("West Midlands");
    expect(context.company).toBeNull();
    expect(typeof context.session_hash).toBe("string");
    expect(context.session_hash!.length).toBeGreaterThan(0);
  });

  it("hashes the same ip/user-agent pair to the same session_hash", async () => {
    cookieStore.set(CONSENT_COOKIE, "all");
    requestHeaders.set("x-forwarded-for", "203.0.113.5");
    requestHeaders.set("user-agent", "Mozilla/5.0 Test");

    const first = await requestContext();
    const second = await requestContext();

    expect(first.session_hash).toBe(second.session_hash);
  });

  it("GAPS C6: bumps the consent counter on every call, declined or not", async () => {
    const rpc = vi.fn(async () => dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ rpc })));

    await requestContext(); // declined — no cookie set
    expect(rpc).toHaveBeenCalledWith("bump_consent_stats", { p_consented: false });

    cookieStore.set(CONSENT_COOKIE, "all");
    await requestContext();
    expect(rpc).toHaveBeenCalledWith("bump_consent_stats", { p_consented: true });
  });

  it("logs rather than throws when the consent counter fails", async () => {
    // Fire-and-forget: a failed counter must never take down the page view it
    // was measuring.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: null, error: { message: "rpc missing" } }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ rpc })));

    await expect(requestContext()).resolves.toBeTruthy();
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "[analytics] bump_consent_stats failed:",
        "rpc missing",
      ),
    );
  });
});

describe("sessionHash (GDPR.md G2)", () => {
  it("is stable for one visitor and differs between visitors", () => {
    expect(sessionHash("203.0.113.7", "Mozilla/5.0")).toBe(sessionHash("203.0.113.7", "Mozilla/5.0"));
    expect(sessionHash("203.0.113.7", "Mozilla/5.0")).not.toBe(sessionHash("203.0.113.8", "Mozilla/5.0"));
    expect(sessionHash("203.0.113.7", "Mozilla/5.0")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("depends on the server key, so it can't be recomputed from an IP without it", () => {
    const withKey = sessionHash("203.0.113.7", "Mozilla/5.0");
    vi.stubEnv("SUPABASE_SECRET_KEY", "a-different-key");
    try {
      expect(sessionHash("203.0.113.7", "Mozilla/5.0")).not.toBe(withKey);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("deviceFromUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "desktop"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "desktop"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "mobile"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "mobile"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", "tablet"],
    ["Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "tablet"],
    ["", "desktop"],
  ])("%s → %s", (ua, expected) => {
    expect(deviceFromUserAgent(ua)).toBe(expected);
  });
});

describe("countryFromHeader", () => {
  it("keeps a two-letter code, uppercased", () => {
    expect(countryFromHeader("gb")).toBe("GB");
    expect(countryFromHeader(" IE ")).toBe("IE");
  });

  it("drops anything else", () => {
    expect(countryFromHeader(null)).toBeNull();
    expect(countryFromHeader(undefined)).toBeNull();
    expect(countryFromHeader("")).toBeNull();
    expect(countryFromHeader("GBR")).toBeNull();
    expect(countryFromHeader("<x>")).toBeNull();
  });
});
