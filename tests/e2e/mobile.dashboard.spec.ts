import { expect, test, type Page } from "@playwright/test";

/**
 * Member area at phone (390, `mobile` project) and tablet (768, `tablet`)
 * widths — the #33 audit's member-area findings (sub-issue #38). One check per
 * measurable defect; ids in each title match the audit (M1, M3 …).
 */
const PASSWORD = "local-dev-password";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', "member1@smi.local");
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 640;

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("M1: the current section's tab is on screen even when it sits at the far end of the strip", async ({ page }) => {
  for (const [path, label] of [["/dashboard/settings", "Settings"], ["/dashboard/stats", "Stats"], ["/dashboard/help", "Help"]] as const) {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Console sections" });
    const current = nav.locator('[aria-current="page"]');
    await expect(current).toHaveText(label);
    const [navBox, tabBox] = [await nav.boundingBox(), await current.boundingBox()];
    expect(tabBox!.x).toBeGreaterThanOrEqual(navBox!.x - 1);
    expect(tabBox!.x + tabBox!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width + 1);
    await noSidewaysScroll(page);
  }
});

test("M20: Add equipment lights the Add content tab", async ({ page }) => {
  await page.goto("/dashboard/equipment/new");
  await expect(page.getByRole("navigation", { name: "Console sections" }).locator('[aria-current="page"]')).toHaveText("Add content");
});

test("H14/M18: the member header is light and the logo shares one row with the account menu", async ({ page }) => {
  await page.goto("/dashboard");
  const header = page.locator("header").first();
  const bg = await header.evaluate((el) => getComputedStyle(el).backgroundColor);
  // rgb(255, 255, 255) — anything near-black fails
  const [r, g, b] = bg.match(/\d+/g)!.map(Number);
  expect(Math.min(r, g, b)).toBeGreaterThan(200);
  const logo = await header.getByRole("img", { name: "Sheet Metal Industries" }).boundingBox();
  const account = await header.getByRole("button", { name: /^Account:/ }).boundingBox();
  // same row: the account button's vertical centre falls within the logo's height
  const centre = account!.y + account!.height / 2;
  expect(centre).toBeGreaterThan(logo!.y - 8);
  expect(centre).toBeLessThan(logo!.y + logo!.height + 8);
  // Phone: ~73px logo row (the 60px stacked lockup) + the tab strip ≈ 117px.
  // It was 138px over three rows before #33.
  expect((await header.boundingBox())!.height).toBeLessThan(isPhone(page) ? 120 : 140);
});

test("M3: each invoice shows its date, amount and status without sideways scrolling", async ({ page }) => {
  await page.goto("/dashboard/settings/billing");
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  await noSidewaysScroll(page);
  const row = page.locator("tbody tr").first();
  const cells = row.locator("td");
  const count = await cells.count();
  test.skip(count < 5, "the seeded member has no invoices");
  const viewport = page.viewportSize()!.width;
  for (let i = 0; i < count; i++) {
    const box = await cells.nth(i).boundingBox();
    expect(box, `cell ${i} visible`).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport);
  }
});

test("M4: content status tabs never break a label over two lines", async ({ page }) => {
  await page.goto("/dashboard/submissions");
  const tabs = page.getByRole("navigation", { name: "Content status" }).getByRole("link");
  for (const name of ["Awaiting approval", "Needs attention"]) {
    const tab = tabs.filter({ hasText: name });
    const lines = await tab.evaluate((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      const range = document.createRange();
      range.selectNodeContents(el);
      return Math.round(range.getBoundingClientRect().height / lh);
    });
    expect(lines).toBe(1);
  }
});

test("M5: on a phone a submission's status sits on its own line, below the title", async ({ page }) => {
  test.skip(!isPhone(page), "phone layout only");
  await page.goto("/dashboard/submissions");
  const status = page.locator("section").getByText(/^(live|ready to review|awaiting approval|scheduled|withdrawn|draft|not published)/).first();
  test.skip((await status.count()) === 0, "no content for the seeded member");
  const badge = page.locator("section p").first().locator("span").first();
  const [badgeBox, statusBox] = [await badge.boundingBox(), await status.boundingBox()];
  expect(statusBox!.y).toBeGreaterThan(badgeBox!.y + badgeBox!.height - 1);
});

test("M10: on a phone the dashboard shows Your submissions before the shortcut cards", async ({ page }) => {
  test.skip(!isPhone(page), "phone layout only");
  await page.goto("/dashboard");
  const submissions = await page.getByRole("heading", { name: "Your submissions" }).boundingBox();
  const cardLink = page.getByRole("main").getByRole("link", { name: /Statistics/ });
  const card = await cardLink.boundingBox();
  expect(submissions!.y).toBeLessThan(card!.y);
  // Source order too, not just paint order: keyboard and screen-reader users
  // must meet the cards where they're drawn (WCAG 2.4.3).
  const cardAfterHeading = await cardLink.evaluate((link) => {
    const heading = [...document.querySelectorAll("h2")].find((h) => h.textContent === "Your submissions")!;
    return Boolean(heading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(cardAfterHeading).toBe(true);
});

test("M2: member-area text fields are at least 16px, so iOS doesn't zoom on focus", async ({ page }) => {
  for (const path of ["/dashboard/settings", "/dashboard/settings/security", "/dashboard/advertising/buy", "/dashboard/profile"]) {
    await page.goto(path);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main input, main select, main textarea")]
        .filter((el) => {
          const type = (el as HTMLInputElement).type;
          if (["hidden", "file", "checkbox", "radio", "submit", "button"].includes(type)) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && parseFloat(getComputedStyle(el).fontSize) < 16;
        })
        .map((el) => el.getAttribute("name") ?? el.id),
    );
    expect(small, path).toEqual([]);
  }
});

test("M7: row actions and the nav are at least 44px tall on touch", async ({ page }) => {
  await page.goto("/dashboard");
  const seeAll = page.getByRole("link", { name: "See all →" }).first();
  expect((await seeAll.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const tab = page.getByRole("navigation", { name: "Console sections" }).getByRole("link").first();
  expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("M8: the Choose File button on an upload field is a real tap target", async ({ page }) => {
  await page.goto("/dashboard/equipment/new");
  // :visible — the editor's image upload is a hidden file input, first in the DOM.
  const input = page.locator('input[type="file"]:visible').first();
  const height = await input.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(40);
});

test("M9: editor toolbar buttons are at least 40px and the toolbar stays in view while typing a long body", async ({ page }) => {
  await page.goto("/dashboard/equipment/new");
  const bold = page.getByRole("button", { name: "B", exact: true }).first();
  const box = await bold.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);
  expect(box!.width).toBeGreaterThanOrEqual(40);

  const editor = page.locator(".ProseMirror").first();
  await editor.click();
  await page.keyboard.type("Line\n".repeat(60));
  const toolbarTop = await bold.evaluate((el) => el.getBoundingClientRect().top);
  expect(toolbarTop).toBeGreaterThanOrEqual(0);
  expect(toolbarTop).toBeLessThan(page.viewportSize()!.height);
});

test("M11: stats charts are labelled by month and never push the page sideways", async ({ page }) => {
  await page.goto("/dashboard/stats");
  await noSidewaysScroll(page);
  const charts = page.locator('[role="img"][aria-label*=" to "]');
  test.skip((await charts.count()) === 0, "no chart data for the seeded member");
  // some labels are deliberately hidden on phones, so look for a visible one
  await expect(page.getByText(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/).filter({ visible: true }).first()).toBeVisible();
});

test("M12/M13: Featured Member's notes box has a visible label and Buy comes after the month choice", async ({ page }) => {
  await page.goto("/dashboard/advertising/buy");
  const notes = page.getByLabel("Timing / notes (optional)").first();
  await expect(notes).toBeVisible();
  const form = page.locator("form").filter({ hasText: "Preferred month" });
  const month = await form.getByText("Preferred month").boundingBox();
  const buy = await form.getByRole("button", { name: "Buy" }).boundingBox();
  expect(buy!.y).toBeGreaterThan(month!.y);
  // the field is no longer a squeezed sliver beside Buy
  expect((await notes.boundingBox())!.width).toBeGreaterThan(200);
});

test("M16: the new login email field gets the full width on a phone", async ({ page }) => {
  test.skip(!isPhone(page), "phone layout only");
  await page.goto("/dashboard/settings/security");
  const field = await page.locator("#email").boundingBox();
  expect(field!.width).toBeGreaterThan(page.viewportSize()!.width * 0.7);
});

test("M17: My page keeps its submit button on screen while the form is in view", async ({ page }) => {
  await page.goto("/dashboard/profile");
  const submit = page.getByRole("button", { name: /Submit (changes|page for approval)/ });
  await page.getByText("About your company").scrollIntoViewIfNeeded();
  const box = await submit.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
});

test("member pages don't scroll sideways", async ({ page }) => {
  for (const path of ["/dashboard", "/dashboard/submissions", "/dashboard/advertising/manage", "/dashboard/advertising/assets", "/dashboard/leads", "/dashboard/notifications", "/dashboard/profile"]) {
    await page.goto(path);
    await noSidewaysScroll(page);
  }
});
