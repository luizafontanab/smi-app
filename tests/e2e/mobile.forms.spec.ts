import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Forms and the standalone auth pages at phone (390) and tablet (768) widths —
 * the `mobile` and `tablet` Playwright projects both run this file (#33).
 * Every check reads layout or attributes the user actually meets: tap height,
 * input font size, what is on the first screen.
 */

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function height(el: Locator) {
  const box = await el.boundingBox();
  expect(box).not.toBeNull();
  return box!.height;
}

/** iOS zooms the page on focus into any field under 16px. */
async function expectNoFocusZoom(page: Page) {
  const sizes = await page.locator("form input:not([type=hidden]):not([type=checkbox]), form textarea, form select")
    .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
}

test("signup form: business-type rows are 44px touch targets and fields don't zoom", async ({ page }) => {
  await page.goto("/join/account");
  await noSidewaysScroll(page);
  await expectNoFocusZoom(page);
  const rows = page.locator("label:has(input[name='membership_types'])");
  const n = await rows.count();
  test.skip(n === 0, "no membership types seeded");
  for (let i = 0; i < n; i++) expect(await height(rows.nth(i))).toBeGreaterThanOrEqual(44);
  // The tick box itself is bigger than the native 13px.
  expect(await height(page.locator("input[name='membership_types']").first())).toBeGreaterThanOrEqual(18);
  // Tapping the row's text ticks the box.
  await rows.first().click();
  await expect(page.locator("input[name='membership_types']").first()).toBeChecked();
});

test("contact form: full-width Send and no focus zoom", async ({ page }) => {
  await page.goto("/contact");
  await noSidewaysScroll(page);
  await expectNoFocusZoom(page);
  const send = page.getByRole("button", { name: "Send" });
  expect(await height(send)).toBeGreaterThanOrEqual(44);
  const formBox = await page.locator("form", { has: send }).boundingBox();
  const sendBox = await send.boundingBox();
  expect(sendBox!.width).toBeGreaterThanOrEqual(formBox!.width - 1);
});

test("advertising: the media-pack form is reachable from the first screen on a phone", async ({ page }) => {
  await page.goto("/advertising");
  await noSidewaysScroll(page);
  const viewport = page.viewportSize()!;
  const jump = page.locator("a[href='#media-pack']");
  if (viewport.width < 640) {
    await expect(jump).toBeVisible();
    const box = await jump.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await jump.click();
    await expect(page.getByLabel("What are you interested in?")).toBeInViewport();
  } else {
    // From sm up the two-column cards keep the form close; no extra button.
    await expect(jump).toBeHidden();
  }
});

test("join: a join button sits on the first screen on a phone", async ({ page }) => {
  await page.goto("/join");
  await noSidewaysScroll(page);
  const viewport = page.viewportSize()!;
  test.skip(viewport.width >= 640, "phone-only CTA");
  const cta = page.getByRole("link", { name: "Join for £40/month" });
  await expect(cta).toBeInViewport();
  expect(await height(cta)).toBeGreaterThanOrEqual(44);
  await cta.click();
  await page.waitForURL("**/join/account");
});

test("long-form page text uses the full phone width", async ({ page }) => {
  await page.goto("/pages/about");
  await noSidewaysScroll(page);
  const viewport = page.viewportSize()!;
  test.skip(viewport.width >= 640, "the card stays from sm up");
  const body = page.locator(".story-body").first();
  await expect(body).toBeVisible();
  const box = await body.boundingBox();
  // 16px gutters either side and no inner card padding.
  expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 32 - 2);
});

for (const path of ["/login", "/reset", "/unsubscribe"]) {
  test(`${path} shows the logo, linking home, and its links are tap-sized`, async ({ page }) => {
    await page.goto(path);
    await noSidewaysScroll(page);
    await expectNoFocusZoom(page);
    const home = page.getByRole("link", { name: "Sheet Metal Industries home" });
    await expect(home).toBeVisible();
    await expect(home.getByRole("img", { name: "Sheet Metal Industries" })).toBeVisible();
    expect(await height(home)).toBeGreaterThanOrEqual(44);
    const secondary = path === "/login" ? "Forgotten your password?" : path === "/reset" ? "Back to sign in" : null;
    if (secondary) expect(await height(page.getByRole("link", { name: secondary }))).toBeGreaterThanOrEqual(44);
    await home.click();
    await page.waitForURL((u) => u.pathname === "/");
  });
}
