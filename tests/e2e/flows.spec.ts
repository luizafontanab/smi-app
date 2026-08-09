import { expect, test } from "@playwright/test";

const PASSWORD = "local-dev-password";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/(console|member)/, { timeout: 20_000 });
}

test.describe("reader (V1/V2)", () => {
  test("homepage renders news-first with rotating adverts", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h3").first()).toBeVisible(); // headline story
    expect(await page.locator('a[aria-label^="Advert:"]').count()).toBeGreaterThan(0);
    // no advert above the headline: first section is the story grid
    const firstAd = page.locator('a[aria-label^="Advert:"]').first();
    const headline = page.locator("h3").first();
    const adBox = await firstAd.boundingBox();
    const headBox = await headline.boundingBox();
    expect(headBox!.y).toBeLessThan(adBox!.y + adBox!.height);
  });

  test("story page carries the member backlink block when member news", async ({ page }) => {
    await page.goto("/news?filter=members");
    await page.locator('a[href^="/news/"]:has(h3)').first().click();
    await expect(page.locator("text=This story features an SMI member")).toBeVisible();
  });

  test("search ranks members before stories", async ({ page }) => {
    // pick a real member name off the directory so the query is guaranteed to match one
    await page.goto("/members");
    const name = await page.locator("a[href^='/members/']").filter({ hasText: /\w/ }).first().textContent();
    const term = name!.trim().split(/\s+/)[0];
    await page.goto(`/search?q=${encodeURIComponent(term)}`);
    const membersHeading = page.locator("h2", { hasText: "Members" });
    await expect(membersHeading).toBeVisible();
    // the Members section renders above any Stories section
    const storiesHeading = page.locator("h2", { hasText: "Stories" });
    if ((await storiesHeading.count()) > 0) {
      const mBox = await membersHeading.boundingBox();
      const sBox = await storiesHeading.boundingBox();
      expect(mBox!.y).toBeLessThan(sBox!.y);
    }
  });
});

test.describe("member self-post → approval → publish (M3/A2 — the core loop)", () => {
  const title = `E2E loop ${Date.now()}`;

  test("submitted story is NOT public until approved, then goes live", async ({ page }) => {
    // member submits
    await login(page, "member2@smi.local");
    await page.goto("/member/story/new");
    await page.fill('input[name="title"]', title);
    await page.fill('textarea[name="body"]', "Body paragraph one.\n\nBody paragraph two.");
    await page.click("button:has-text('Submit for approval')");
    await page.waitForURL("**/member?submitted=story");

    // not on the public site yet — the approval gate
    await page.goto("/news");
    await expect(page.locator(`text=${title}`)).toHaveCount(0);

    // sign out (from the member area header), editor approves
    await page.goto("/member");
    await page.locator("header form button:has-text('Sign out')").click();
    await page.waitForURL("**/login");
    await login(page, "jas@smi.local");
    await page.goto("/console/stories");
    const card = page.locator("div.rounded.border", { hasText: title }).first();
    await expect(card).toBeVisible();
    await card.locator("button:has-text('Approve')").click();
    await page.waitForTimeout(2000);

    // now public
    await page.goto("/news");
    await expect(page.locator(`text=${title}`).first()).toBeVisible();
  });
});

test.describe("admin (A1/A4)", () => {
  test("command centre shows Needs You Today", async ({ page }) => {
    await login(page, "jas@smi.local");
    await page.goto("/console");
    await expect(page.locator("text=Needs you today")).toBeVisible();
  });

  test("advert inventory lists live bookings with caps", async ({ page }) => {
    await login(page, "jas@smi.local");
    await page.goto("/console/adverts");
    await expect(page.locator("text=Live banners")).toBeVisible();
    expect(await page.locator("td:has-text('live')").count()).toBeGreaterThan(0);
  });
});

test.describe("roles", () => {
  test("member cannot open the console", async ({ page }) => {
    await login(page, "member3@smi.local");
    await page.goto("/console");
    await page.waitForURL("**/member", { timeout: 15_000 });
  });
});
