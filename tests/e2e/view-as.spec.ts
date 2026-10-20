import { expect, test, type Page } from "@playwright/test";

/**
 * Fix-list 94 — Jas views a member's real dashboard, read-only, and sees when
 * their login last signed in. Writes a member to the dev database, so the
 * fixture is timestamped like console-members.spec.ts.
 */
const PASSWORD = "local-dev-password";

async function login(page: Page, email: string, landing: RegExp) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(landing, { timeout: 20_000 });
}

/** Creates a member through the console and returns its query-free editor URL. */
async function createMember(page: Page, company: string, email: string) {
  await page.goto("/console/members/new");
  await page.fill('input[name="company"]', company);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Create member')");
  await page.waitForURL(/\/console\/members\/[0-9a-f-]{36}\?created=1/, { timeout: 20_000 });
  return page.url().split("?")[0];
}

test("Jas views a member's dashboard read-only, then returns to the console", async ({ page, browser }) => {
  const ts = Date.now();
  const company = `E2E View As Ltd ${ts}`;
  const email = `e2e-view-as-${ts}@test.local`;
  await login(page, "jas@smi.local", /\/console/);
  const editor = await createMember(page, company, email);

  // a fresh login has never signed in
  await page.goto(editor);
  await expect(page.getByText("Last signed in: Never")).toBeVisible();

  // into the member's own dashboard, with the admin bar on it
  await page.getByRole("button", { name: "View as member" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 20_000 });
  await expect(page.getByTestId("view-as-banner")).toContainText(company);
  await expect(page.getByTestId("member-name")).toHaveText(company);

  // a save is refused, says so, and changes nothing
  await page.goto("/dashboard/settings");
  const before = await page.locator('select[name="stats_frequency"]').inputValue();
  await page.selectOption('select[name="stats_frequency"]', before === "monthly" ? "never" : "monthly");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/dashboard\/settings\?readonly=1/, { timeout: 20_000 });
  await expect(page.getByTestId("view-as-banner").getByRole("alert")).toContainText("wasn't saved");
  await page.goto("/dashboard/settings");
  await expect(page.locator('select[name="stats_frequency"]')).toHaveValue(before);

  // the member's login, not Jas's
  await page.goto("/dashboard/settings/security");
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("jas@smi.local")).toHaveCount(0);

  // out again: back on the member, and the dashboard is closed to Jas once more
  await page.getByRole("button", { name: "Back to console" }).click();
  await page.waitForURL(editor, { timeout: 20_000 });
  await page.goto("/dashboard");
  await page.waitForURL(/\/console$/, { timeout: 20_000 });

  // the member signs in for real, and the console picks it up
  const memberContext = await browser.newContext();
  try {
    await login(await memberContext.newPage(), email, /\/dashboard/);
  } finally {
    await memberContext.close();
  }
  await page.goto(editor);
  await expect(page.getByText(/Last signed in: \d/)).toBeVisible();
});
