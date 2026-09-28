import { expect, test, type Page } from "@playwright/test";

/**
 * /console/releases ("What's new") is admin-only. Unit tests cover the menu
 * link and the parser; what they can't reach is the real gate and the page
 * actually reading its markdown file at request time. Read-only — no fixtures.
 */
const PASSWORD = "local-dev-password";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
}

test("an admin reaches What's new from the account menu", async ({ page }) => {
  await login(page, "jas@smi.local");
  await page.goto("/console");
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("link", { name: "What's new" }).click();
  await page.waitForURL(/\/console\/releases$/);
  await expect(page.getByRole("heading", { level: 1, name: "What's new" })).toBeVisible();
  // At least one release rendered from src/content/release-notes.md.
  await expect(page.locator("article time").first()).toBeVisible();
});

test("member1 cannot reach What's new", async ({ page }) => {
  await login(page, "member1@smi.local");
  await page.goto("/console/releases");
  await page.waitForLoadState("networkidle");
  expect(page.url()).not.toContain("/console/releases");
  await expect(page.getByRole("link", { name: "What's new" })).toHaveCount(0);
});
