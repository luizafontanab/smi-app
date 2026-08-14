import { test, expect } from "@playwright/test";

/**
 * Impressions are the headline metric sold to advertisers, so they must reflect
 * what a reader actually saw. Asserts on the beacons this page sends rather than
 * on a global row count, so other workers cannot skew it.
 */
test("impressions count only adverts that loaded and were actually on screen", async ({ page }) => {
  // The longest test in the suite by construction: it reads down the whole home
  // page with a 1.6s dwell per screen (5 screens) plus a 2.5s park — 12s of
  // deliberate waiting before the page has even loaded. The default 30s leaves
  // too little for a networkidle load of a 28-image page when a second worker is
  // compiling routes on the same dev server. Nothing here is weakened; it is the
  // wall-clock budget that was too tight.
  test.setTimeout(60_000);

  // Playwright cannot read sendBeacon's Blob body, so record the calls in the
  // page itself and still forward them, keeping the real write path intact.
  await page.addInitScript(() => {
    const w = window as unknown as { __seen: string[] };
    w.__seen = [];
    const original = navigator.sendBeacon?.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      if (String(url).includes("/api/seen") && data instanceof Blob) {
        void data.text().then((t) => w.__seen.push(...(JSON.parse(t).ids ?? [])));
      }
      return original ? original(url, data) : true;
    };
  });
  const seen = () => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });

  // Every advert on the page must render real artwork. A blocked or broken image
  // leaves a blank box the same size, which is exactly the bug this guards.
  const links = page.locator('a[aria-label^="Advert:"]');
  const onPage = await links.count();
  expect(onPage, "adverts present on the homepage").toBeGreaterThan(0);
  const ids = await links.evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).pathname.split("/").pop()!));
  for (let i = 0; i < onPage; i++) {
    const widths = await links.nth(i).locator("img").evaluateAll((imgs) =>
      imgs.filter((im) => (im as HTMLImageElement).offsetParent !== null).map((im) => (im as HTMLImageElement).naturalWidth),
    );
    expect(widths.some((w) => w > 0), `advert ${i} artwork actually loaded`).toBe(true);
  }

  // The homepage opens on a full-bleed hero and carries no advert beside it, so
  // nothing is on screen at rest — scroll the first banner into view and park
  // there. The rule under test is "only what is on screen counts", not "an
  // advert sits above the fold".
  await links.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  const top = await seen();
  expect(top.length, "the advert parked on screen was counted").toBeGreaterThan(0);
  expect(top.length, "but not the ones still below the fold").toBeLessThan(onPage);

  // Read down the page the way a person does. A teleport to the bottom would
  // legitimately count nothing — an advert that flew past was not seen.
  const screens = await page.evaluate(() => Math.ceil(document.body.scrollHeight / window.innerHeight));
  for (let i = 1; i <= screens; i++) {
    await page.evaluate((n) => window.scrollTo(0, n * window.innerHeight * 0.8), i);
    await page.waitForTimeout(1600);
  }
  await page.waitForTimeout(1500);

  const all = await seen();
  expect([...all].sort(), "every advert counted exactly once after reading past it").toEqual([...ids].sort());
});
