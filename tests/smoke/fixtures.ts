import { expect, test as base } from "@playwright/test";

/**
 * Shared fixture for the smoke suite. Its job is the suite's one promise:
 * sign in, look, change nothing.
 *
 * Every request the browser makes to this machine (the app, the local Supabase
 * stack) is checked; any to a hosted Supabase project fails the test outright.
 * GET/HEAD/OPTIONS pass. Anything
 * else — a server action, a form post, a beacon, a direct Supabase write — is
 * aborted and recorded, and the test fails afterwards with the list. So a page
 * that starts writing on load turns this suite red instead of quietly adding
 * rows. The only writes let through are the sign-in action itself (while
 * signIn() is running) and Supabase's own token refresh.
 *
 * This guards the browser only. Writes a server component makes while rendering
 * are invisible to Playwright — those are kept out by which routes the specs
 * visit (see the notes in each spec) and by global-setup.ts refusing any
 * non-local Supabase.
 */

export const ADMIN_STATE = "tests/smoke/.auth/admin.json";
export const MEMBER_STATE = "tests/smoke/.auth/member.json";
const PASSWORD = "local-dev-password";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const HOSTED_SUPABASE = /\.supabase\.(co|in)$/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Same cookies, same reasons, as tests/visual/lib/auth.ts:
 * - smi-consent=essential: no analytics_events / search_queries rows
 *   ("all" would write them), and the consent banner stays out of the way.
 * - smi-ads=empty: no adverts render, so no /api/seen impression beacons.
 */
const COOKIES = [
  { name: "smi-consent", value: "essential" },
  { name: "smi-ads", value: "empty" },
];

/** Headings of every error boundary and 404 page — none should ever show. */
const FAILURE_HEADINGS = [
  "Something went wrong at our end", // (public)/error.tsx
  "This page failed to load", // dashboard/error.tsx
  "This screen failed to load", // console/error.tsx
  /couldn.t find that page/, // (public)/not-found.tsx
  /That page doesn.t exist/, // not-found.tsx
];

type Guard = {
  /** Non-safe requests that were aborted. */
  blocked: string[];
  /** Requests to a hosted Supabase project — means the app isn't on the local stack. */
  hosted: string[];
  /** Uncaught exceptions in the page. */
  pageErrors: string[];
  /** True only inside signIn(), so the login action can go through. */
  signingIn: boolean;
};

type Fixtures = {
  guard: Guard;
  /** Sign in through the real /login form. The only write this suite makes. */
  signIn: (email: string) => Promise<void>;
  /** Load a page and assert it rendered: status < 400, no error boundary, the main landmark. */
  visit: (path: string, opts?: { landmark?: boolean }) => Promise<void>;
};

// Fixture callbacks name Playwright's `use` param `provide` (as tests/e2e/join.spec.ts
// does) — eslint's react-hooks rule can't tell it apart from a React hook call.
export const test = base.extend<Fixtures>({
  guard: [
    async ({ page, baseURL }, provide) => {
      const guard: Guard = { blocked: [], hosted: [], pageErrors: [], signingIn: false };
      const context = page.context();
      const origin = new URL(baseURL!).origin;

      await context.addCookies(COOKIES.map((c) => ({ ...c, url: origin })));

      await context.route("**/*", (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const label = `${req.method()} ${url.origin === origin ? "" : url.origin}${url.pathname}${url.search}`;

        if (HOSTED_SUPABASE.test(url.hostname)) {
          guard.hosted.push(label);
          return route.abort("blockedbyclient");
        }
        // Third-party embeds (YouTube's player posts to googleapis.com) can't
        // reach our database — only this machine's hosts (the app, the local
        // Supabase stack) are policed.
        if (!LOCAL_HOSTS.has(url.hostname) || SAFE_METHODS.has(req.method())) return route.continue();

        const sameOrigin = url.origin === origin;
        const allowed =
          // dev-server internals (HMR, the error overlay's stack-frame lookups)
          (sameOrigin && (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/__nextjs"))) ||
          // Supabase rotating its own session token — auth bookkeeping, not content
          url.pathname === "/auth/v1/token" ||
          // the sign-in server action, and only while signIn() is driving it
          (guard.signingIn && sameOrigin && url.pathname === "/login");
        if (allowed) return route.continue();

        guard.blocked.push(req.headers()["next-action"] ? `${label} (server action)` : label);
        return route.abort("blockedbyclient");
      });

      page.on("pageerror", (err) => guard.pageErrors.push(err.message));

      await provide(guard);

      expect(guard.hosted, "requests reached a hosted Supabase project — the app is not on the local stack").toEqual([]);
      expect(guard.blocked, "the page tried to write (a /api/client-errors POST means it threw)").toEqual([]);
      expect(guard.pageErrors, "uncaught exceptions in the page").toEqual([]);
    },
    { auto: true },
  ],

  signIn: async ({ page, guard }, provide) => {
    await provide(async (email) => {
      guard.signingIn = true;
      try {
        await page.goto("/login");
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="password"]', PASSWORD);
        await page.click("button:has-text('Sign in')");
        await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
      } finally {
        guard.signingIn = false;
      }
    });
  },

  visit: async ({ page }, provide) => {
    await provide(async (path, { landmark = true } = {}) => {
      const res = await page.goto(path);
      expect(res, `${path}: no response`).not.toBeNull();
      expect(res!.status(), `${path}: HTTP status`).toBeLessThan(400);
      // let client effects run, so anything they try to send is caught by the guard
      await page.waitForLoadState("networkidle");
      for (const name of FAILURE_HEADINGS) {
        await expect(page.getByRole("heading", { name }), `${path}: rendered an error page`).toHaveCount(0);
      }
      if (landmark) await expect(page.locator("main#main"), `${path}: no main landmark`).toBeVisible();
    });
  },
});

export { expect };
