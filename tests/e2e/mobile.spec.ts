import { expect, test } from "@playwright/test";

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
