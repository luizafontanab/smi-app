import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  // Refuses to start unless both the env files and the running dev server
  // point at the local Supabase stack — these specs write through the server,
  // and a .env.local aimed at a hosted project would aim them there too.
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 30_000,
  // Local failures should stay loud (a retried flake hides a real race);
  // in CI one retry absorbs the Docker stack's latency spikes.
  retries: process.env.CI ? 1 : 0,
  // Serial on purpose. The dev-mode server + local Supabase saturate under
  // concurrent workers — server-action logins start timing out and passing
  // tests look broken. Measured on an M-series dev machine: ~30 failures at
  // 6 workers, ~20 at 3, ~11 at 2, all of them 30s navigation timeouts that
  // vanish when the same specs run alone. Slow and green beats fast and
  // unreadable; revisit if e2e ever runs against a production build.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [
    // The existing suite is written for desktop interactions (hover, drag) —
    // keep it there, and give the mobile project its own smoke spec rather
    // than running everything twice under emulation.
    { name: "desktop", testIgnore: /mobile(\.[a-z-]+)?\.spec\.ts/ },
    // Chromium device emulation — no extra browser install. Catches the
    // console-table overflow and mobile-nav class of regression.
    {
      name: "mobile",
      testMatch: /mobile(\.[a-z-]+)?\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    // #33: mobile.spec.ts plus one mobile.<area>.spec.ts per surface, so
    // phone/tablet checks can grow by area without one file owning them all.
    // 768 is a real target, not a spot check — the header is still the
    // drawer here (below lg) while card grids have stepped up from one column.
    {
      name: "tablet",
      testMatch: /mobile(\.[a-z-]+)?\.spec\.ts/,
      use: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
