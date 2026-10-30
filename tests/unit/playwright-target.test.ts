import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectSrcOrigins, isRemoteSupabaseRequest, serverTargetProblem } from "../smoke/target";

/**
 * The Playwright suites' database guards (tests/smoke/target.ts). Both suites
 * reuse whatever server is already on :3100, and the e2e suite writes through
 * it — so "which database is that server really using?" is the question that
 * keeps a test run off production.
 */

// The header next.config.ts sends in dev — captured from the local server on
// 16 Oct 2026, Google Maps hosts added 29 Oct — so the parser is pinned
// against the real shape.
const LOCAL_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com http://localhost:8400; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://i.ytimg.com https://*.stripe.com http://127.0.0.1:56321; " +
  "font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' data: blob: https://*.googleapis.com https://*.google.com https://*.gstatic.com https://api.stripe.com https://checkout.stripe.com http://127.0.0.1:56321 ws: wss: http://localhost:8400; " +
  "media-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
const withConnect = (origin: string) => LOCAL_CSP.replace("http://127.0.0.1:56321 ws:", `${origin} ws:`);

describe("isRemoteSupabaseRequest (the smoke suite's browser guard)", () => {
  it("catches a hosted project, as before", () => {
    expect(isRemoteSupabaseRequest(new URL("https://bvyxeujhecxulzwvpxfr.supabase.co/rest/v1/stories"))).toBe(true);
    expect(isRemoteSupabaseRequest(new URL("https://abc.supabase.in/auth/v1/token"))).toBe(true);
  });

  it("catches a project behind a custom domain by its API paths — the old host-only check let these through", () => {
    for (const p of ["/rest/v1/members", "/auth/v1/user", "/storage/v1/object/public/media/a.jpg", "/realtime/v1/websocket", "/functions/v1/x"]) {
      expect(isRemoteSupabaseRequest(new URL(`https://db.sheetmetalindustries.com${p}`)), p).toBe(true);
    }
  });

  it("leaves the local stack and unrelated third parties alone", () => {
    expect(isRemoteSupabaseRequest(new URL("http://127.0.0.1:56321/rest/v1/stories"))).toBe(false);
    expect(isRemoteSupabaseRequest(new URL("http://localhost:56321/auth/v1/token"))).toBe(false);
    expect(isRemoteSupabaseRequest(new URL("https://www.youtube-nocookie.com/embed/abc"))).toBe(false);
    expect(isRemoteSupabaseRequest(new URL("https://play.googleapis.com/log?format=json"))).toBe(false);
  });
});

describe("connectSrcOrigins", () => {
  it("reads the http(s) origins of connect-src only", () => {
    expect(connectSrcOrigins(LOCAL_CSP)).toEqual([
      "https://*.googleapis.com",
      "https://*.google.com",
      "https://*.gstatic.com",
      "https://api.stripe.com",
      "https://checkout.stripe.com",
      "http://127.0.0.1:56321",
      "http://localhost:8400",
    ]);
  });

  it("returns nothing without a header or a connect-src", () => {
    expect(connectSrcOrigins(null)).toEqual([]);
    expect(connectSrcOrigins("default-src 'self'")).toEqual([]);
  });
});

describe("serverTargetProblem (both suites' check of a reused server)", () => {
  it("accepts a server on the local stack the env files name", () => {
    expect(serverTargetProblem(LOCAL_CSP, "http://127.0.0.1:56321")).toBeNull();
  });

  it("refuses a server talking to a hosted project, whatever the env files now say", () => {
    // the case the env-file check alone missed: files fixed, old server still up
    expect(serverTargetProblem(withConnect("https://bvyxeujhecxulzwvpxfr.supabase.co"), "http://127.0.0.1:56321")).toMatch(
      /talking to https:\/\/bvyxeujhecxulzwvpxfr\.supabase\.co/,
    );
  });

  it("refuses a server started against a different local stack than the files name", () => {
    expect(serverTargetProblem(withConnect("http://127.0.0.1:54321"), "http://127.0.0.1:56321")).toMatch(/restart it/);
  });

  it("refuses a server it can't verify rather than trusting it", () => {
    expect(serverTargetProblem(null, "http://127.0.0.1:56321")).toMatch(/cannot be verified/);
    expect(serverTargetProblem("connect-src 'self' https://api.stripe.com", "http://127.0.0.1:56321")).toMatch(/cannot be verified/);
  });

  it("doesn't mistake Google Maps' hosts for a database", () => {
    expect(serverTargetProblem("connect-src 'self' https://*.googleapis.com https://*.google.com https://*.gstatic.com", "http://127.0.0.1:56321")).toMatch(
      /cannot be verified/,
    );
  });
});

describe("playwright.config.ts (the e2e suite)", () => {
  const config = readFileSync(path.resolve(__dirname, "../../playwright.config.ts"), "utf8");

  it("runs the shared database guard before any spec", () => {
    expect(config).toMatch(/globalSetup: "\.\/tests\/e2e\/global-setup\.ts"/);
    expect(readFileSync(path.resolve(__dirname, "../e2e/global-setup.ts"), "utf8")).toMatch(/assertLocalTarget\("e2e"\)/);
  });

  it("stays serial — workers: 1 is deliberate (see the config's comment)", () => {
    expect(config).toMatch(/^\s*workers: 1,/m);
  });
});
