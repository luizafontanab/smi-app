import { expect, test } from "@playwright/test";

/**
 * The hero's contract, in one test:
 *   - it loads on the CURRENT article (rail card 1), always
 *   - it never rotates on its own
 *   - hover promotes; leaving the hero returns to card 1
 *   - keyboard focus promotes too
 *
 * The stage is aria-hidden (it duplicates the active card), which does not
 * affect Playwright's visibility or text matching. toHaveText auto-retries, so
 * it absorbs the 520ms crossfade without an explicit wait.
 */
test("hero opens on the current article, follows hover and focus, and never auto-rotates", async ({ page }) => {
  await page.goto("/");

  const cards = page.getByTestId("hero-card");
  const stageTitle = page.getByTestId("hero-stage-title");
  await expect(cards).toHaveCount(5);

  // Video cards carry an sr-only suffix inside the h3; the stage shows the bare title.
  const titleOf = async (n: number) =>
    (await cards.nth(n).locator("h3").textContent())!.replace(" — video, opens on YouTube", "").trim();
  const first = await titleOf(0);

  await expect(stageTitle).toHaveText(first);
  await expect(cards.nth(0)).toHaveAttribute("data-active", "true");

  // the whole point: it must still be the same article after sitting there
  await page.waitForTimeout(3000);
  await expect(stageTitle).toHaveText(first);

  const third = await titleOf(2);
  await cards.nth(2).hover();
  await expect(stageTitle).toHaveText(third);
  await expect(cards.nth(2)).toHaveAttribute("data-active", "true");

  // leaving the hero entirely returns to the headline
  await page.mouse.move(5, 5);
  await expect(stageTitle).toHaveText(first);

  const second = await titleOf(1);
  await cards.nth(1).focus();
  await expect(stageTitle).toHaveText(second);
});

test("every hero card is a real link, and no advert sits in or above the hero", async ({ page }) => {
  await page.goto("/");

  const cards = page.getByTestId("hero-card");
  for (let i = 0; i < (await cards.count()); i++) {
    const href = await cards.nth(i).getAttribute("href");
    expect(href, `hero card ${i} links somewhere`).toMatch(/^(\/news\/|https:\/\/www\.youtube\.com\/)/);
  }

  // advert neutrality: news first, never an advert above it
  const hero = page.locator("section.hero");
  expect(await hero.locator('a[aria-label^="Advert:"]').count()).toBe(0);
  const heroBox = (await hero.boundingBox())!;
  const adBox = (await page.locator('a[aria-label^="Advert:"]').first().boundingBox())!;
  expect(adBox.y).toBeGreaterThan(heroBox.y + heroBox.height);
});
