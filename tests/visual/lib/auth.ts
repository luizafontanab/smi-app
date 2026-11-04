/**
 * Login state for the three roles a capture can run as.
 *
 * Each role logs in ONCE per run and is saved as a Playwright storageState, so
 * ~86 captures cost 2 logins rather than 86. The form flow is the canonical one
 * from tests/e2e/a11y.spec.ts:20-26 — this suite deliberately does not refactor
 * those specs onto a shared helper, which would put e2e in its blast radius.
 *
 * The written files carry live Supabase refresh tokens. .gitignore excludes
 * tests/visual/.state/ and that entry landed before the first write.
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser } from "playwright";

export type Role = "anon" | "member" | "admin";
export const ROLES: Role[] = ["anon", "member", "admin"];

/** Seeded logins (scripts/seed.ts). Same password for all local accounts. */
const ACCOUNTS: Record<Exclude<Role, "anon">, string> = {
  member: "member1@smi.local",
  admin: "jas@smi.local",
};
const PASSWORD = "local-dev-password";

export const STATE_DIR = path.resolve(__dirname, "../.state");

/**
 * Cookies every capture starts with. These are not "ignore what changed"
 * suppression — without them nothing is comparable at all:
 *
 * smi-consent  Dismisses the consent banner, which is `fixed bottom-0 z-50` and
 *              otherwise covers the foot of every public shot. The value MUST be
 *              "essential", never "all": analyticsConsented() (src/lib/analytics.ts:44)
 *              only records on "all", and 15 page components call record() on GET —
 *              so an "all" run would write analytics_events rows that the NEXT run's
 *              /dashboard/stats and /console/analytics would render. The suite would
 *              fail against itself. CookieConsent.tsx:8 only tests for the cookie
 *              NAME, so "essential" dismisses it just as well.
 * smi-ads      Empties advert inventory for this browser (src/lib/adverts.ts:30-33),
 *              so the unseeded Math.random shuffle in dealSlots never runs and every
 *              slot draws its deterministic dashed placeholder instead — no carousel.
 *              showAdPlaceholders() honours the cookie even in a production build.
 * smi-theme    The homepage has two structurally different designs. Pin grid, the
 *              design going live (ask-jas 17, site default since A8.2). Inert
 *              while the design switcher is off — grid is then served regardless
 *              (#33) — and kept so the suite stays right if the switcher returns.
 */
export const DEFAULT_COOKIES = [
  { name: "smi-consent", value: "essential" },
  { name: "smi-ads", value: "empty" },
  { name: "smi-theme", value: "grid" },
];

/** Logs each role in and writes .state/<role>.json. Returns role -> file path. */
export async function ensureStates(browser: Browser, baseURL: string): Promise<Record<Role, string>> {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const paths = {} as Record<Role, string>;

  for (const role of ROLES) {
    const file = path.join(STATE_DIR, `${role}.json`);
    const context = await browser.newContext({ baseURL });
    try {
      if (role !== "anon") {
        const page = await context.newPage();
        await page.goto("/login");
        await page.fill('input[name="email"]', ACCOUNTS[role]);
        await page.fill('input[name="password"]', PASSWORD);
        await page.click("button:has-text('Sign in')");
        // requireMember/requireConsole bounce the wrong role, so landing on
        // either is proof the session exists; the route check below proves which.
        await page.waitForURL(/\/(console|dashboard)/, { timeout: 30_000 });
        await page.close();
      }
      // Added after login so they survive into the saved state.
      await context.addCookies(DEFAULT_COOKIES.map((c) => ({ ...c, url: baseURL })));
      await context.storageState({ path: file });
      paths[role] = file;
    } finally {
      await context.close();
    }
  }
  return paths;
}

/**
 * Proves each role reaches its own area rather than being redirected to /login.
 * A silently-anonymous admin state would otherwise produce 24 baselines of the
 * login page and nobody would notice until the diff.
 */
export async function verifyStates(browser: Browser, baseURL: string, paths: Record<Role, string>): Promise<void> {
  const probes: Record<Role, string> = { anon: "/", member: "/dashboard", admin: "/console" };
  for (const role of ROLES) {
    const context = await browser.newContext({ baseURL, storageState: paths[role] });
    const page = await context.newPage();
    await page.goto(probes[role], { waitUntil: "domcontentloaded" });
    const landed = new URL(page.url()).pathname;
    await context.close();
    if (landed !== probes[role]) {
      throw new Error(`visual: ${role} state failed — ${probes[role]} redirected to ${landed}`);
    }
  }
}
