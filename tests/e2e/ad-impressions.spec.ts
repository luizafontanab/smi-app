import { test, expect } from "@playwright/test";

/**
 * Impressions are the headline metric sold to advertisers, so they must reflect
 * what a reader actually saw. Asserts on the beacons this page sends rather than
 * on a global row count, so other workers cannot skew it.
 */
test("impressions count only adverts that loaded and were actually on screen", async ({ page }) => {
  const reported: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/seen")) {
      reported.push(...(JSON.parse(r.postData() ?? "{}").ids ?? []));
    }
  });

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

  // Parked above the fold: only what is on screen may count.
  await page.waitForTimeout(2500);
  expect(reported.length, "some adverts counted while parked at the top").toBeGreaterThan(0);
  expect(reported.length, "but not the ones still below the fold").toBeLessThan(onPage);

  // Read down the page the way a person does. A teleport to the bottom would
  // legitimately count nothing — an advert that flew past was not seen.
  const screens = await page.evaluate(() => Math.ceil(document.body.scrollHeight / window.innerHeight));
  for (let i = 1; i <= screens; i++) {
    await page.evaluate((n) => window.scrollTo(0, n * window.innerHeight * 0.8), i);
    await page.waitForTimeout(1600);
  }
  await page.waitForTimeout(1500);

  expect([...reported].sort(), "every advert counted exactly once after reading past it").toEqual([...ids].sort());
});
