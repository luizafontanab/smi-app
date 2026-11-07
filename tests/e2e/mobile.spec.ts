import { expect, test } from "@playwright/test";
import { ROUTES, type Role, type Route } from "../visual/manifest";

/**
 * Runs only under the `mobile` Playwright project (390×844, touch — see
 * playwright.config.ts). Smoke coverage for the phone-width regressions this
 * hardening pass fixed: drawer nav, console table overflow, no sideways page
 * scroll.
 */
const PASSWORD = "local-dev-password";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
}

test("home renders without horizontal page scroll and the drawer nav works", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.locator("dialog[open]");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "News", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Close menu" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test("the news index stacks to one usable column", async ({ page }) => {
  await page.goto("/news");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("wide console tables scroll inside their own container, not the page", async ({ page }) => {
  await login(page, "jas@smi.local");
  await page.goto("/console/adverts");
  await expect(page.locator("table").first()).toBeVisible();
  // the page itself must not scroll sideways…
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(0);
  // …because the table's wrapper does
  const wrapped = await page.locator("div.overflow-x-auto > table").count();
  expect(wrapped).toBeGreaterThan(0);
});

test("member billing table is reachable and contained", async ({ page }) => {
  await login(page, "member1@smi.local");
  await page.goto("/dashboard/settings/billing");
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(0);
});

test("the member cloud reveals a logo on first tap and follows the link on the second", async ({ page }) => {
  await page.goto("/member?view=cloud"); // bare /member is the tile list since 28 Oct
  // A phone has no hover, so the logo needs a tap of its own — but the name must
  // still be a link, not a button, for everyone else.
  // :visible — phones and touch tablets draw a sample of the cloud (#36), so
  // the alphabetically first member may be hidden.
  const item = page.locator("li.cloud-item:visible").first();
  const name = item.locator(".cloud-name");
  const href = await name.getAttribute("href");
  expect(href).toMatch(/^\/member\/[^/]+$/);

  await name.tap();
  await expect(item.locator(".cloud-card")).toHaveCSS("opacity", "1");
  expect(new URL(page.url()).pathname).toBe("/member");

  await name.tap();
  await page.waitForURL(href!);
});

test("the member cloud does not push the page sideways", async ({ page }) => {
  await page.goto("/member?view=cloud"); // bare /member is the tile list since 28 Oct
  await expect(page.locator("#member-cloud")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

/*
 * ── #33: every page, at phone and tablet width ────────────────────────────
 *
 * The route list is the visual suite's manifest, so a page added there is
 * swept here too without a second list to keep in step. One test per role,
 * looping its routes with soft assertions: a failure names every offending
 * route at once, and each role logs in once instead of once per page.
 *
 * Only sideways page scroll is asserted. It is the one mobile defect that is
 * always wrong, on every page, whatever the design — anything subtler is
 * pinned by its own test below once it is fixed.
 */

const ACCOUNT: Record<Exclude<Role, "anon">, string> = { member: "member1@smi.local", admin: "jas@smi.local" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A route pinned to one local record, re-aimed at a record that exists in this
 * database: the first link on its `liveIdFrom` list page whose path is the
 * route's own with a different id. CI seeds a fresh database, so the pinned
 * ids only exist on the machine that pinned them.
 */
async function livePath(page: import("@playwright/test").Page, route: Route): Promise<string> {
  if (!route.liveIdFrom) return route.path;
  const prefix = route.path.slice(0, route.path.lastIndexOf("/") + 1);
  await page.goto(route.liveIdFrom, { waitUntil: "load" });
  const hrefs = await page.locator(`a[href^="${prefix}"]`).evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  const live = hrefs.find((h) => UUID.test(h.slice(prefix.length)));
  expect.soft(live, `${route.id}: no ${prefix}<id> link on ${route.liveIdFrom}`).toBeDefined();
  return live ?? route.path;
}

for (const role of ["anon", "member", "admin"] as const) {
  // Desktop entries only: the @phone copies are the same paths, and this
  // project already sets the viewport.
  const routes = ROUTES.filter((r) => r.role === role && !r.skip && r.device !== "phone");

  test(`no ${role} page scrolls sideways (${routes.length} routes)`, async ({ page }) => {
    test.setTimeout(routes.length * 15_000);
    if (role !== "anon") await login(page, ACCOUNT[role]);
    for (const route of routes) {
      if (route.cookies) await page.context().addCookies(route.cookies.map((c) => ({ ...c, url: page.url() })));
      const path = await livePath(page, route);
      const response = await page.goto(path, { waitUntil: "load" });
      // A pinned example that has gone (after a reseed) is a stale pin, not a
      // layout pass — say so rather than measuring the not-found page.
      expect.soft(response?.status(), `${route.id}: ${path} did not load`).toBeLessThan(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflow, `${route.id}: ${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });
}

// Jas (4 Nov): "I have added an event and featured machine to the desktop
// version but cannot see them in the mobile". Grid's homepage shows both at
// every width; this keeps them there.
//
// The featured event always shows (booked, else the backup, else the next
// upcoming one). The machine shows only while a booking is running, so the
// test takes the machine from /featured-machine, the site's own answer to
// "what is featured today", rather than assuming the seed has one booked.
test("the homepage shows whatever machine is featured, and the featured event", async ({ page }) => {
  await page.goto("/featured-machine");
  // The public routes stream behind a loading skeleton, and count() doesn't
  // wait — hold for the page's own heading before asking what it lists.
  await expect(page.getByRole("heading", { level: 1, name: "Featured Machine" })).toBeVisible();
  const featured = page.locator("main article h2").first();
  const machine = (await featured.count()) > 0 ? (await featured.textContent())!.trim() : null;

  await page.goto("/");
  // Scoped to main: the header carries a "Featured Machine" nav link of its
  // own, hidden below md, which would otherwise be the first match.
  const main = page.locator("main");
  await expect(main.getByText(/^featured event$/i)).toBeVisible();
  if (machine) {
    await expect(main.locator('a[href="/featured-machine"]').filter({ hasText: machine })).toBeVisible();
  } else {
    test.info().annotations.push({ type: "note", description: "no featured machine is booked today in this database — machine half not exercised" });
  }
});

// #33: the console calendars widened the page on a phone two ways — the day
// labels' sr-only spans escaped the scroller's clipping, and the month bar
// couldn't wrap. The sweep above only sees the overview's calendar (the
// others sit behind ?view=calendar, which the manifest doesn't list).
test("console calendar views do not scroll sideways", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, "jas@smi.local");
  for (const path of ["/console/stories", "/console/videos", "/console/events", "/console/newsletter"]) {
    await page.goto(`${path}?view=calendar`);
    await expect(page.locator("div.min-w-\\[720px\\]")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect.soft(overflow, `${path} calendar scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});
