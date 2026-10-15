import { defineConfig } from "@playwright/test";

/**
 * Smoke suite: `pnpm test:smoke`. Signs in, looks at pages, changes nothing.
 *
 * Kept in its own config rather than as a project in playwright.config.ts so
 * the local-database guard (global-setup.ts) and the no-write request guard
 * (fixtures.ts) belong to this suite alone. The main e2e suite writes on
 * purpose; this one must never, and neither should be able to weaken the other.
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
