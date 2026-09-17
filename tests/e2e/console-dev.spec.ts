import { expect, test, type Page } from "@playwright/test";

/**
 * The Dev Board + "Feedback" (bug-report) widget. The risk here is entirely in the
 * wiring — root gate -> client dialog -> hidden JSON field -> action -> RLS
 * grants -> the board rendering a widget-submitted row indistinguishably from
 * a manually quick-added one — which unit tests cannot reach.
 *
 * Writes to the dev database, so every fixture is timestamped like
 * console-members.spec.ts. Reuses its loginAsJas, but not its URL
 * assertions elsewhere in that file — those target a stale route shape.
 */
const PASSWORD = "local-dev-password";

async function loginAsJas(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', "jas@smi.local");
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/console/, { timeout: 20_000 });
}

async function loginAsMember1(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', "member1@smi.local");
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
}

/** The column's container div, found via its heading text ("Not started (3)" etc). */
function column(page: Page, label: string) {
  return page.getByRole("heading", { name: new RegExp(`^${label}\\b`) }).locator("xpath=..");
}

/** The card's own container, found by its title link. */
function card(page: Page, title: string) {
  return page.getByRole("link", { name: title, exact: true }).locator("xpath=../..");
}

test.describe("Report a bug widget", () => {
  test("is hidden from anonymous visitors and members", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Feedback" })).toHaveCount(0);

    await loginAsMember1(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Feedback" })).toHaveCount(0);
  });

  test("member1 cannot reach the Dev Board", async ({ page }) => {
    await loginAsMember1(page);
    await page.goto("/console/dev");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/console/dev");
  });
});

test.describe("filing a report and working it on the board", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsJas(page);
  });

  test("a widget report lands on the board, gets triaged, and is indistinguishable from a quick-add only by its Bug badge", async ({ page }) => {
    const ts = Date.now();
    const title = `E2E dev task ${ts}`;

    // File it from a public page, not from the console itself.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Feedback" })).toBeVisible();
    await page.getByRole("button", { name: "Feedback" }).click();
    await page.locator("#dev-task-title").fill(title);
    await page.locator("#dev-task-kind").selectOption("bug");
    await page.locator("#dev-task-priority").selectOption("high");
    await page.getByRole("button", { name: "Log it" }).click();
    await expect(page.getByText("Logged", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#dev-task-title")).toBeHidden();

    // It's on the board, in Not started, with a Bug badge.
    await page.goto("/console/dev");
    const notStarted = column(page, "Not started");
    await expect(notStarted.getByRole("link", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(card(page, title).getByText("Bug", { exact: true })).toBeVisible();
    await expect(card(page, title).getByText("high", { exact: true })).toBeVisible();

    // Open its detail page: the auto-captured snapshot is there, read-only.
    await page.getByRole("link", { name: title, exact: true }).click();
    await page.waitForURL(/\/console\/dev\/[0-9a-f-]{36}/, { timeout: 20_000 });
    const detailUrl = page.url().split("?")[0];
    await expect(page.getByText("Reported from the site")).toBeVisible();
    // The captured snapshot renders as one <pre> block, not per-line elements.
    // Scoped to its section: in dev, dnd-kit's known aria-describedby
    // hydration warning opens the Next overlay, which adds its own <pre>s.
    const snapshot = page.locator("section", { hasText: "Reported from the site" }).locator("pre");
    await expect(snapshot).toContainText("URL:");
    await expect(snapshot).toContainText("Viewport");

    // Triage it: reclassify, leave a scratchpad note, move it along.
    await page.locator("#kind").selectOption("idea");
    await page.locator("#triage_notes").fill("Not a bug — reclassified during triage.");
    await page.locator("#status").selectOption("coding");
    await page.getByRole("button", { name: "Save" }).click();
    // Save returns to the (filtered) board, not the detail page.
    await page.waitForURL(/\/console\/dev\?.*saved=1/, { timeout: 20_000 });

    // The card moved columns.
    await expect(column(page, "Coding").getByRole("link", { name: title, exact: true })).toBeVisible({ timeout: 20_000 });

    // Re-open the detail page: every field persisted.
    await page.goto(detailUrl);
    await expect(page.locator("#kind")).toHaveValue("idea");
    await expect(page.locator("#status")).toHaveValue("coding");
    await expect(page.locator("#triage_notes")).toHaveValue("Not a bug — reclassified during triage.");

    // A manually quick-added task on the same board carries no kind badge —
    // the one visible signal that distinguishes a widget report from either.
    await page.goto("/console/dev");
    const quickTitle = `E2E quick add ${ts}`;
    const notStartedInput = column(page, "Not started").locator('input[placeholder="+ Add task"]');
    await notStartedInput.fill(quickTitle);
    await notStartedInput.press("Enter");
    await expect(column(page, "Not started").getByRole("link", { name: quickTitle, exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(card(page, quickTitle).getByText("Bug", { exact: true })).toHaveCount(0);

    // Clean up both fixtures via the detail page's delete, confirm-gated.
    for (const t of [title, quickTitle]) {
      await page.goto("/console/dev");
      await page.getByRole("link", { name: t, exact: true }).click();
      await page.waitForURL(/\/console\/dev\/[0-9a-f-]{36}/, { timeout: 20_000 });

      // Refuses without the confirm box.
      await page.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByText("Tick the confirm box")).toBeVisible({ timeout: 20_000 });

      await page.locator('input[name="confirm"]').check();
      await page.getByRole("button", { name: "Delete" }).click();
      await page.waitForURL(/\/console\/dev\?.*deleted=1/, { timeout: 20_000 });
    }
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: quickTitle, exact: true })).toHaveCount(0);
  });
});
