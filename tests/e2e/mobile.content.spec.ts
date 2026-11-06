import { expect, test, type Page } from "@playwright/test";

/**
 * #33 content pages at phone (390) and tablet (768) width: homepage, news,
 * stories, videos and search. Runs under the `mobile` and `tablet` projects
 * (playwright.config.ts). One check per fixed defect where it's measurable;
 * checks that only apply on a phone skip on the tablet project.
 */
const PASSWORD = "local-dev-password";

const isPhone = () => test.info().project.name === "mobile";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const fontPx = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

/** Relative luminance of an element's own background colour (0 black → 1 white). */
const bgLuminance = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    // The first painted background up the tree: a band with no fill of its
    // own shows whatever is behind it (white page = light).
    let node: Element | null = el;
    let bg = "rgba(0, 0, 0, 0)";
    while (node && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
      bg = getComputedStyle(node).backgroundColor;
      node = node.parentElement;
    }
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = "rgb(255, 255, 255)";
    const m = bg.match(/[\d.]+/g)!.map(Number);
    // A tint (bg-brand/10) is mostly the white page behind it: blend over white.
    const alpha = m.length > 3 ? m[3] : 1;
    const [r, g, b] = m.slice(0, 3).map((v) => {
      const c = (v * alpha + 255 * (1 - alpha)) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  });

/** First story page (from the news grid) that has a cover image, or null. */
async function storyWithCover(page: Page): Promise<string | null> {
  await page.goto("/news");
  // Streamed behind a loading skeleton: evaluateAll() and count() don't wait.
  await expect(page.locator('[data-testid="all-news-grid"] a').first()).toBeVisible();
  const hrefs = await page.locator('[data-testid="all-news-grid"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")!).slice(0, 8));
  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.locator("main h1")).toBeVisible();
    // The hero's own marker, not "any image below the h1": a cover-less story
    // (flows.spec publishes one each run) still has card and logo images
    // further down, which the old guess took for its cover.
    if ((await page.locator('main [data-testid="story-cover"]').count()) > 0) return href;
  }
  return null;
}

// ── Homepage ─────────────────────────────────────────────────────────────

test("home has no sideways scroll, signed out and signed in", async ({ page }) => {
  await page.goto("/");
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await login(page, "member1@smi.local");
  await page.goto("/");
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test("More news tiles show their cover on a touch screen without a tap (C3)", async ({ page }) => {
  await page.goto("/");
  const img = page.locator("li.gh-tile img").first();
  test.skip((await img.count()) === 0, "no More news tile has a cover in this data");
  await expect(img).toHaveCSS("opacity", "1");
});

test("on a phone, Upcoming events comes before Latest videos (C9)", async ({ page }) => {
  test.skip(!isPhone(), "phone-only reorder");
  await page.goto("/");
  const events = page.getByRole("heading", { name: "Upcoming events" });
  test.skip((await events.count()) === 0, "no upcoming events in this data");
  const videos = page.getByRole("heading", { name: "Latest videos" });
  const e = (await events.boundingBox())!;
  const v = (await videos.boundingBox())!;
  expect(e.y).toBeLessThan(v.y);
});

test("Featured members scrolls sideways below lg and doesn't move on its own (C12)", async ({ page }) => {
  await page.goto("/");
  const head = page.getByRole("heading", { name: "Featured members" });
  test.skip((await head.count()) === 0, "no featured member placements in this data");
  const list = page.locator("main ul").filter({ has: page.locator('a[href^="/member/"]') }).first();
  const before = await list.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop, canScrollY: el.scrollHeight > el.clientHeight + 1 }));
  // a vertical inner scroller on a phone traps the thumb
  expect(before.canScrollY).toBe(false);
  await page.waitForTimeout(6_000); // longer than the 4.5s auto-advance
  const after = await list.evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
  expect(after).toEqual({ left: before.left, top: before.top });
});

test("the stats band closing the homepage is light (C10)", async ({ page }) => {
  await page.goto("/");
  // >> visible=true: the homepage renders its below-fold run twice when the
  // phone order differs (one copy per breakpoint), so take the one on screen.
  const band = "section:has(h2:text('Brand awareness that reaches the right buyers')) >> visible=true";
  await expect(page.locator(band)).toBeVisible();
  expect(await bgLuminance(page, band)).toBeGreaterThan(0.8);
});

test("home card titles are at least 16px on a phone (C4)", async ({ page }) => {
  test.skip(!isPhone(), "phone sizes only");
  await page.goto("/");
  // The public routes stream behind a loading skeleton; evaluateAll doesn't wait.
  await expect(page.locator("main h3").first()).toBeVisible();
  const sizes = await page.locator("main h3").evaluateAll((els) =>
    els.filter((el) => el.getBoundingClientRect().width > 0).map((el) => parseFloat(getComputedStyle(el).fontSize)),
  );
  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
});

// ── News ─────────────────────────────────────────────────────────────────

test("news search and date inputs are 16px so iOS doesn't zoom (C5)", async ({ page }) => {
  await page.goto("/news");
  for (const sel of ['input[name="q"]', 'input[name="from"]', 'input[name="to"]']) {
    expect(await fontPx(page, sel), sel).toBeGreaterThanOrEqual(16);
  }
});

test("industry pills are 44px tap targets (C6)", async ({ page }) => {
  await page.goto("/news");
  const pills = page.getByRole("navigation", { name: "Filter by industry" }).getByRole("link");
  test.skip((await pills.count()) === 0, "industries_public is off");
  expect((await pills.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("news grid story titles are at least 16px on a phone (C4)", async ({ page }) => {
  test.skip(!isPhone(), "phone sizes only");
  await page.goto("/news");
  expect(await fontPx(page, '[data-testid="all-news-grid"] h3')).toBeGreaterThanOrEqual(16);
});

// ── Story page ───────────────────────────────────────────────────────────

test("on a phone the story's top advert sits below the cover, not above it (C1)", async ({ page }) => {
  test.skip(!isPhone(), "phone-only reorder");
  const href = await storyWithCover(page);
  test.skip(!href, "no story with a cover in this data");
  const order = await page.evaluate(() => {
    const cover = document.querySelector('main [data-testid="story-cover"]')!;
    const ad = [...document.querySelectorAll('main a[aria-label^="Advert:"]')].find((a) => a.getBoundingClientRect().height > 0);
    return ad ? { coverBottom: cover.getBoundingClientRect().bottom, adTop: ad.getBoundingClientRect().top } : null;
  });
  test.skip(!order, "no advert booked on the story page");
  expect(order!.adTop).toBeGreaterThanOrEqual(order!.coverBottom);
});

test("the story's back link is a 44px tap target (C16)", async ({ page }) => {
  await page.goto("/news");
  await page.locator('[data-testid="all-news-grid"] a').first().click();
  const back = page.getByRole("link", { name: /Back to News/ });
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("the join band above the footer is light (E18)", async ({ page }) => {
  // /advertising always carries the join band (a story's layout may not).
  // 0.6, not 0.8: the band is a light orange tint (~0.79); the old ink band
  // measured ~0.01, so this still fails anything dark.
  await page.goto("/advertising");
  const band = "section:has(h2:text(\"Join the UK's sheet metal community\"))";
  await expect(page.locator(band)).toBeVisible();
  expect(await bgLuminance(page, band)).toBeGreaterThan(0.6);
});

// ── Videos ───────────────────────────────────────────────────────────────

test("video search input is 16px on a phone (C5)", async ({ page }) => {
  await page.goto("/video");
  expect(await fontPx(page, 'input[name="q"]')).toBeGreaterThanOrEqual(16);
});

test("a video page offers more videos, a 44px back link and 44px share buttons (C14, C16)", async ({ page }) => {
  await page.goto("/video");
  const links = page.locator('main a[href^="/video/"]');
  const distinct = new Set(await links.evaluateAll((as) => as.map((a) => a.getAttribute("href"))));
  test.skip(distinct.size === 0, "no videos in this data");
  await links.first().click();
  await page.waitForURL(/\/video\/.+/);

  expect((await page.getByRole("link", { name: /All videos/ }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByRole("button", { name: "LinkedIn" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // with any other published video there is somewhere to go next
  if (distinct.size > 1) {
    await expect(page.getByRole("heading", { name: "More videos" })).toBeVisible();
    const cards = page.locator("section:has(h2:text('More videos')) a[href^='/video/']").filter({ visible: true });
    expect(await cards.count()).toBeGreaterThan(0);
  }
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

// ── Search ───────────────────────────────────────────────────────────────

test("member search results show plain text, not HTML (C2)", async ({ page }) => {
  // "laser" matched ten members when the audit found the raw HTML.
  await page.goto("/search?q=laser");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const members = page.locator("section:has(h2:text('Members')) a[href^='/member/']");
  test.skip((await members.count()) === 0, "no member matches in this data");
  const texts = await members.allInnerTexts();
  for (const t of texts) expect(t).not.toMatch(/<\/?[a-z][^>]*>|&amp;|&nbsp;/i);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});
