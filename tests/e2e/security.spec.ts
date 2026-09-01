import { expect, test } from "@playwright/test";

/**
 * Locks in the open-redirect fix: ?next= must only ever land on an internal
 * path. A phishing link like /login?next=//evil.test/console previously issued
 * a real 307 off-site immediately after a successful sign-in.
 */
test.describe("login ?next= open-redirect", () => {
  const PASSWORD = "local-dev-password";

  async function signInWithNext(page: import("@playwright/test").Page, next: string) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.fill('input[name="email"]', "member1@smi.local");
    await page.fill('input[name="password"]', PASSWORD);
    await page.click("button:has-text('Sign in')");
  }

  test("a protocol-relative next lands on the dashboard, not off-site", async ({ page }) => {
    await signInWithNext(page, "//evil.test/console");
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    expect(new URL(page.url()).host).toContain("127.0.0.1");
  });

  test("an absolute URL next likewise stays on-site", async ({ page }) => {
    await signInWithNext(page, "https://evil.test/phish");
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    expect(new URL(page.url()).host).toContain("127.0.0.1");
  });

  test("a legitimate internal next still works", async ({ page }) => {
    await signInWithNext(page, "/dashboard/billing");
    await page.waitForURL("**/dashboard/billing", { timeout: 20_000 });
  });
});
