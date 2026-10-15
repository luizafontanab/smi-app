import { defineConfig } from "@playwright/test";

/**
 * Smoke suite: `pnpm test:smoke`. Signs in, looks at pages, changes nothing.
 *
 * Kept in its own config rather than as a project in playwright.config.ts so
 * the no-write request guard (fixtures.ts) belongs to this suite alone. The
 * main e2e suite writes on purpose; this one must never, and neither should be
 * able to weaken the other.
 *
 * The local-database guard is the one thing the two suites share, on purpose:
 * assertLocalTarget (tests/smoke/global-setup.ts) is the global setup of this
 * suite and, imported, of the e2e one (tests/e2e/global-setup.ts). It checks
 * the env files, then the Supabase origin that the server already answering on
 * 3100 reports in its CSP — the helpers for that live in tests/smoke/target.ts,
 * Playwright-free so tests/unit can pin them. fixtures.ts takes its
 * hosted-Supabase request check from the same file.
 */
export default defineConfig({
  testDir: "tests/smoke",
  globalSetup: "./tests/smoke/global-setup.ts",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // Serial for the same reason as playwright.config.ts: the dev server and the
  // local Supabase stack saturate under concurrent workers.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "smoke", testMatch: /\.spec\.ts/, dependencies: ["setup"] },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
