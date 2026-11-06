import { expect, test, type Page } from "@playwright/test";

/**
 * Header, drawer, footer and cookie banner on phone (390) and tablet (768) —
 * the `mobile` and `tablet` Playwright projects run this file. One check per
 * defect fixed in the #33 mobile pass (H1–H13).
 */
const PASSWORD = "local-dev-password";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
}

/** Dismiss the cookie banner up front, so it can't sit over what's measured. */
async function consent(page: Page, baseURL: string | undefined) {
  await page.context().addCookies([{ name: "smi-consent", value: "all", url: baseURL ?? "http://127.0.0.1:3100" }]);
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 640;

test.describe("header", () => {
  test.beforeEach(async ({ page, baseURL }) => consent(page, baseURL));

  test("the logo keeps its natural size and nothing in the bar wraps (H1, H4)", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header").first();
    const logo = header.locator("img").first();
    // ~209px for the stacked lockup at h-18 on a phone (matched to the live
    // site), ~310px for the wide mark at sm:h-12 — it used to be squeezed to
    // 136–159px.
    const box = (await logo.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(isPhone(page) ? 200 : 300);
    // One row: the phone bar is ~89px by design (72px logo + 8px padding);
    // the bar was 101px (phone) / 81px (tablet) when labels wrapped.
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(isPhone(page) ? 92 : 80);
    for (const el of await header.locator("nav > *").all()) {
      if (!(await el.isVisible())) continue;
      expect((await el.boundingBox())!.height).toBeLessThanOrEqual(48);
    }
  });

  test("phones show only the logo and menu button; the drawer carries join and login (H1)", async ({ page }) => {
    test.skip(!isPhone(page), "phone-only layout");
    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: "Become a Member" })).toBeHidden();
    await expect(header.getByRole("link", { name: "Login" })).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.locator("dialog[open]");
    await expect(drawer.getByRole("link", { name: "Become a Member" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Login" })).toBeVisible();
  });

  test("the menu button is at least 44×44 and sits at the right edge (H3)", async ({ page }) => {
    await page.goto("/");
    const menu = (await page.getByRole("button", { name: "Open menu" }).boundingBox())!;
    expect(menu.width).toBeGreaterThanOrEqual(44);
    expect(menu.height).toBeGreaterThanOrEqual(44);
    // Nothing else in the bar sits to its right.
    for (const el of await page.locator("header nav > *").all()) {
      if (!(await el.isVisible())) continue;
      expect((await el.boundingBox())!.x).toBeLessThanOrEqual(menu.x);
    }
  });

  test("tablets get the Media menu in the bar, and a tap opens it (H4)", async ({ page }) => {
    test.skip(isPhone(page), "tablet-only layout");
    await page.goto("/");
    await page.locator("header").getByRole("button", { name: /Media/ }).tap();
    await expect(page.locator("header").getByRole("link", { name: "News", exact: true }).filter({ visible: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the industry strip is a single row (H5, H6)", async ({ page }) => {
    await page.goto("/");
    const strip = page.getByRole("navigation", { name: "Industries" });
    test.skip((await strip.count()) === 0, "industries_public is off");
    // One 44px touch row plus borders — tablets had three rows, 137px.
    expect((await strip.boundingBox())!.height).toBeLessThanOrEqual(50);
  });
});

test.describe("drawer", () => {
  test.beforeEach(async ({ page, baseURL }) => consent(page, baseURL));

  test("reaches the bottom of the screen and is light (H7, H9)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.locator("dialog[open]");
    const box = (await drawer.boundingBox())!;
    const vh = await page.evaluate(() => window.innerHeight);
    expect(box.y + box.height).toBeGreaterThanOrEqual(vh - 1);
    // White, not the near-black chrome it used to be.
    const bg = await drawer.evaluate((d) => getComputedStyle(d).backgroundColor);
    expect(bg).toBe("rgb(255, 255, 255)");
  });

  test("every row is a 16px, 44px-tall target and the close button stays reachable (H8)", async ({ page }) => {
    await login(page, "member1@smi.local");
    await page.goto("/news");
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.locator("dialog[open]");
    for (const el of await drawer.locator("a, button").all()) {
      const box = (await el.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      if ((await el.getAttribute("aria-label")) === "Close menu") continue;
      expect(await el.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    }
    // Scrolled to the end, Sign out is in view and Close is still on screen.
    await drawer.evaluate((d) => d.scrollTo(0, d.scrollHeight));
    await expect(drawer.getByRole("button", { name: "Sign out" })).toBeInViewport();
    await expect(drawer.getByRole("button", { name: "Close menu" })).toBeInViewport();
  });
});

test.describe("footer", () => {
  test.beforeEach(async ({ page, baseURL }) => consent(page, baseURL));

  test("Cookie settings and the social links are full touch targets (H10)", async ({ page }) => {
    await page.goto("/news");
    const footer = page.locator("footer").last();
    const cookie = (await footer.getByRole("button", { name: "Cookie settings" }).boundingBox())!;
    expect(cookie.height).toBeGreaterThanOrEqual(44);
    const x = (await footer.getByRole("link", { name: "X", exact: true }).boundingBox())!;
    expect(x.width).toBeGreaterThanOrEqual(44);
    expect(x.height).toBeGreaterThanOrEqual(44);
  });

  test("the newsletter field is wide enough to read, and 16px on a phone (H11, E19)", async ({ page }) => {
    await page.goto("/news");
    const input = page.locator("footer").last().getByRole("textbox", { name: "Email address" });
    expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(200);
    if (isPhone(page)) {
      expect(await input.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    }
  });

  test("two newsletter forms on one page have their own ids (H12)", async ({ page }) => {
    await page.goto("/pages/about");
    const fields = page.locator('form input[type="email"]');
    expect(await fields.count()).toBeGreaterThanOrEqual(2);
    const refs = await fields.evaluateAll((els) => els.flatMap((e) => [e.id, e.getAttribute("aria-describedby") ?? ""]));
    expect(new Set(refs).size).toBe(refs.length);
  });
});

test.describe("cookie banner", () => {
  test("links the cookie policy and doesn't cover the end of the page (H13)", async ({ page }) => {
    await page.goto("/news");
    const banner = page.getByRole("region", { name: "Cookie consent" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: "Cookie policy" })).toHaveAttribute("href", "/pages/policies");

    // At the very bottom, the footer's last line sits above the banner, not under it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const copyright = (await page.getByText(/All rights reserved/).boundingBox())!;
    const bannerBox = (await banner.boundingBox())!;
    expect(copyright.y + copyright.height).toBeLessThanOrEqual(bannerBox.y + 1);
  });
});
