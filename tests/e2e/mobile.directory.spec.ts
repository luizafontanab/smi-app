import { expect, test, type Page } from "@playwright/test";

/**
 * #33 events and directory fixes, under the `mobile` (390) and `tablet` (768)
 * projects. One check per measurable defect; ids refer to the mobile audit.
 */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 640;

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("events", () => {
  test("search input is 16px on phones so iOS does not zoom (E5/inputs)", async ({ page }) => {
    await page.goto("/event");
    await noSideScroll(page);
    const size = await page.getByRole("searchbox", { name: "Search events" }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (isPhone(page)) expect(size).toBeGreaterThanOrEqual(16);
  });

  test("event filter pills are 44px tall on touch with text of at least 12px", async ({ page }) => {
    await page.goto("/event");
    const pills = page.locator("main a[href^='/event']").filter({ hasText: /^(All|Webinar|Live event|Open house|Exhibition|Golf challenge)$/ });
    // Streamed behind a loading skeleton: count() doesn't wait.
    await expect(pills.first()).toBeVisible();
    expect(await pills.count()).toBeGreaterThanOrEqual(2);
    for (const pill of await pills.all()) {
      expect((await pill.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await pill.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
    }
  });

  test("the event map is short enough on a phone to scroll past (E1)", async ({ page }) => {
    await page.goto("/event");
    const map = page.getByRole("region", { name: "Map of upcoming event locations" });
    test.skip((await map.count()) === 0, "no geocoded upcoming events in this data");
    const box = (await map.boundingBox())!;
    if (isPhone(page)) expect(box.height).toBeLessThanOrEqual(340);
  });

  test("phones get the month as a readable agenda, tablets keep the grid (E3)", async ({ page }) => {
    await page.goto("/event");
    const calendar = page.locator("#calendar");
    const agendaLinks = calendar.locator("ol a[href^='/event/']");
    if (isPhone(page)) {
      // either events with their full titles, or the empty message — never truncated chips
      const empty = calendar.getByText("No events this month.");
      if ((await empty.count()) === 0) {
        const first = agendaLinks.first();
        await expect(first).toBeVisible();
        const fits = await first.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
        expect(fits).toBe(true);
      } else {
        await expect(empty).toBeVisible();
      }
    } else {
      await expect(calendar.locator(".grid-cols-7").first()).toBeVisible();
      await expect(agendaLinks.first()).toBeHidden();
    }
  });

  test("past-event rows put the title under (phone) or beside (tablet) the date, never mixed (E2)", async ({ page }) => {
    await page.goto("/event");
    // Streamed behind a loading skeleton: count() and boundingBox() don't wait.
    await expect(page.getByRole("heading", { name: "Past events" })).toBeVisible();
    const rows = page.locator("section:has(h2:text-is('Past events')) li");
    test.skip((await rows.count()) === 0, "no past events");
    const n = Math.min(await rows.count(), 8);
    const lefts: number[] = [];
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const date = (await row.locator("span").first().boundingBox())!;
      const title = (await row.locator("a").first().boundingBox())!;
      if (isPhone(page)) expect(title.y).toBeGreaterThanOrEqual(date.y + date.height - 1);
      lefts.push(Math.round(title.x));
    }
    // every title starts at the same x — the ragged layout put some beside the date and some under it
    expect(new Set(lefts).size).toBe(1);
  });

  test("tapping an event card's excerpt opens the event (E4)", async ({ page }) => {
    await page.goto("/event");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const card = page.locator("div.relative:has(> h2 a[href^='/event/'])").first();
    test.skip((await card.count()) === 0, "no upcoming events");
    await expect(card).toBeVisible();
    const href = await card.locator("h2 a").getAttribute("href");
    // Tap by coordinates: the stretched link sits over the text, so a locator
    // tap on the text would fail Playwright's "receives events" check — which is
    // exactly the behaviour under test.
    // Left edge, below the title: date/location/excerpt text, not a link of its own.
    const card_ = (await card.boundingBox())!;
    const title = (await card.locator("h2").boundingBox())!;
    await page.touchscreen.tap(card_.x + 12, title.y + title.height + 12);
    await page.waitForURL(`**${href}`);
  });

  test("the event page offers its website link before the description (E6)", async ({ page }) => {
    await page.goto("/event");
    const href = await page.locator("a[href^='/event/']").filter({ hasNotText: "All events" }).first().getAttribute("href");
    await page.goto(href!);
    const site = page.getByRole("link", { name: "Event website →" });
    test.skip((await site.count()) === 0, "this event has no website link");
    const first = (await site.first().boundingBox())!;
    const h1 = (await page.locator("h1").boundingBox())!;
    expect(first.y - (h1.y + h1.height)).toBeLessThan(200);
    expect(first.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("member directory", () => {
  test("the search box keeps a usable width and 16px text (E11)", async ({ page }) => {
    await page.goto("/member");
    await noSideScroll(page);
    const input = page.getByRole("searchbox", { name: "Search members" });
    const box = (await input.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(240);
    if (isPhone(page)) expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  });

  test("directory tiles are compact on a phone (E12)", async ({ page }) => {
    await page.goto("/member");
    const tile = page.locator("main a[href^='/member/']").filter({ has: page.locator("p.font-bold") }).last();
    const box = (await tile.boundingBox())!;
    if (isPhone(page)) expect(box.height).toBeLessThanOrEqual(110);
  });

  test("the cloud on a touch screen is a capped sample with a way to the full list (E13/E14)", async ({ page }) => {
    await page.goto("/member?view=cloud");
    await expect(page.locator("#member-cloud")).toBeVisible();
    await noSideScroll(page);
    const total = await page.locator("li.cloud-item").count();
    const shown = await page.locator("li.cloud-item:visible").count();
    expect(shown).toBeLessThanOrEqual(isPhone(page) ? 50 : 120);
    if (shown < total) await expect(page.getByRole("link", { name: "See them all in the list" })).toBeVisible();
    // ~21,000px before on a phone
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThan(isPhone(page) ? 8000 : 7000);
  });

  test("touch-screen cloud names sit at least 24px apart (E14)", async ({ page }) => {
    await page.goto("/member?view=cloud");
    await page.locator("#member-cloud-refined").waitFor({ state: "attached" });
    await page.waitForTimeout(900); // the settle eases for 700ms
    const tops = await page.locator("li.cloud-item:visible:not([data-featured]) .cloud-name").evaluateAll((els) =>
      els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, w: r.width }; }),
    );
    // closest vertical distance between two names that share horizontal space
    let closest = Infinity;
    for (let i = 0; i < tops.length; i++)
      for (let j = i + 1; j < tops.length; j++) {
        const a = tops[i], b = tops[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w) closest = Math.min(closest, Math.abs(a.y - b.y));
      }
    expect(closest).toBeGreaterThanOrEqual(24);
  });

  test("the profile header stacks the logo above the name on a phone (E8)", async ({ page }) => {
    await page.goto("/member");
    const href = await page.locator("main a[href^='/member/']").first().getAttribute("href");
    await page.goto(href!);
    await expect(page.locator("h1")).toBeVisible();
    const h1 = (await page.locator("h1").boundingBox())!;
    if (isPhone(page)) expect(h1.width).toBeGreaterThanOrEqual(300);
    await noSideScroll(page);
  });
});

test("an empty featured-machine month offers somewhere to go (E16)", async ({ page }) => {
  await page.goto("/featured-machine");
  await noSideScroll(page);
  const empty = page.getByRole("heading", { name: "No featured machine this month" });
  test.skip((await empty.count()) === 0, "a machine is featured this month");
  const onward = page.getByRole("link", { name: "Find a member →" });
  await expect(onward).toBeVisible();
  expect((await onward.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
