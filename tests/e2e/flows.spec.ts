import { expect, test } from "@playwright/test";

const PASSWORD = "local-dev-password";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  // members land on /dashboard (the member area) — /member is the public directory
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
}

test.describe("reader (V1/V2)", () => {
  test("homepage renders news-first with rotating adverts", async ({ page }) => {
    await page.goto("/");
    // the headline story is card 1 of the hero rail, and the hero stage opens on it
    const headline = page.getByTestId("hero-card").first().locator("h3");
    await expect(headline).toBeVisible();
    expect(await page.locator('a[aria-label^="Advert:"]').count()).toBeGreaterThan(0);
    // no advert above the headline: first section is the story grid
    const firstAd = page.locator('a[aria-label^="Advert:"]').first();
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
    await page.goto("/member");
    const name = await page.locator("a[href^='/member/']").filter({ hasText: /\w/ }).first().textContent();
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

test.describe("member directory — category combobox + text search", () => {
  test("the pill wall is gone; the combobox filters by type-ahead", async ({ page }) => {
    await page.goto("/member");
    // the old flat list of category links is no longer rendered (noscript is inert)
    await expect(page.locator('a[href^="/member?category="]')).toHaveCount(0);

    const trigger = page.getByRole("button", { name: /All categories/ });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const filter = page.getByRole("combobox", { name: "Filter categories" });
    await expect(filter).toBeFocused(); // focus moves into the panel on open
    const total = await page.getByRole("option").count();
    expect(total).toBeGreaterThan(10);

    await filter.fill("las");
    expect(await page.getByRole("option").count()).toBeLessThan(total);

    const option = page.getByRole("option").first();
    const label = (await option.textContent())!.trim();
    await option.click();
    await page.waitForURL(/\/member\?category=/);
    await expect(page.getByRole("button", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
  });

  test("Escape closes the panel and returns focus to the trigger", async ({ page }) => {
    await page.goto("/member");
    const trigger = page.getByRole("button", { name: /All categories/ });
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });

  test("category and search term survive each other", async ({ page }) => {
    await page.goto("/member");
    const name = (await page.locator('a[href^="/member/"]').filter({ hasText: /\w/ }).first().textContent())!.trim();
    const term = name.split(/\s+/)[0];

    // pick a category first — the form's hidden field must carry it through the search
    await page.getByRole("button", { name: /All categories/ }).click();
    await page.getByRole("option").nth(1).click();
    await page.waitForURL(/category=/);
    const chosen = new URL(page.url()).searchParams.get("category")!;

    await page.getByRole("searchbox", { name: "Search members" }).fill(term);
    await page.keyboard.press("Enter");
    await page.waitForURL(/q=/);
    expect(new URL(page.url()).searchParams.get("category")).toBe(chosen);

    // and the reverse: clearing the category keeps q
    await page.getByRole("button", { name: "Clear category filter" }).click();
    await page.waitForURL((u) => !u.searchParams.has("category"));
    expect(new URL(page.url()).searchParams.get("q")).toBe(term);
  });

  test("a term full of PostgREST delimiters cannot widen the filter", async ({ page }) => {
    // unsanitised, the first of these returns every active member
    for (const q of ["zzzz,id.not.is.null", "zzzz)", "%%%"]) {
      await page.goto(`/member?q=${encodeURIComponent(q)}`);
      await expect(page.getByText("No members found.")).toBeVisible();
    }
  });
});

test.describe("public header follows the session", () => {
  test("anonymous visitors get the join/login pair", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: "Become a Member", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Login" })).toBeVisible();
    // and the navy CTA band is still there for them
    await expect(page.getByRole("main").getByRole("link", { name: "Become a Member", exact: true })).toBeVisible();
  });

  test("signed-in member sees their name linking to the member area, and no join CTA", async ({ page }) => {
    await login(page, "member2@smi.local");
    // the member area header shows the company name — that's what the public header should echo
    const company = (await page.locator("header span.text-white\\/60").first().textContent())!.trim();

    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: "Become a Member", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Login" })).toHaveCount(0);
    const chip = header.getByRole("link", { name: company, exact: true });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("href", "/dashboard");

    // the navy "Become a Member" band is gone for signed-in visitors too
    await expect(page.getByRole("link", { name: "Become a Member", exact: true })).toHaveCount(0);

    await chip.click();
    await page.waitForURL("**/dashboard");
  });

  test("console user gets a console link, not a member one", async ({ page }) => {
    await login(page, "jas@smi.local");
    await page.goto("/");
    const chip = page.locator("header").first().getByRole("link", { name: "Jas", exact: true });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("href", "/console");
  });

  test("previously-static pages render the session too", async ({ page }) => {
    test.setTimeout(90_000); // three routes dev compiles on demand, plus a login
    await login(page, "member2@smi.local");
    for (const path of ["/join", "/contact", "/advertising"]) {
      await page.goto(path);
      await expect(page.locator("header").first().getByRole("link", { name: "Login" })).toHaveCount(0);
    }
  });
});

test.describe("member self-post → approval → publish (M3/A2 — the core loop)", () => {
  const title = `E2E loop ${Date.now()}`;

  test("WYSIWYG story survives the approval gate; preview shows branding; XSS stays inert", async ({ page }) => {
    // member writes in the WYSIWYG editor
    await login(page, "member2@smi.local");
    await page.goto("/dashboard/story/new");
    await page.fill('input[name="title"]', title);
    const editor = page.locator('[contenteditable="true"]');
    await editor.click();
    await page.keyboard.type("Body paragraph one.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Paragraph two with <img src=x onerror=alert(1)> typed as text.");
    await page.keyboard.press("Enter");
    await page.click('button[title="Bold"]');
    await page.keyboard.type("Bold statement.");

    // preview shows the backlink + branding BEFORE publish (req §7 fix)
    await page.click("button:has-text('Preview')");
    await expect(page.locator("text=This story features an SMI member")).toBeVisible();
    await expect(page.getByTestId("story-preview").locator("p", { hasText: "Body paragraph one." })).toBeVisible();
    await page.click("button:has-text('Write')");

    await page.click("button:has-text('Submit for approval')");
    await page.waitForURL("**/dashboard?submitted=story");

    // not on the public site yet — the approval gate
    await page.goto("/news");
    await expect(page.locator(`text=${title}`)).toHaveCount(0);

    // sign out (from the member area header), editor approves
    await page.goto("/dashboard");
    await page.locator("header form button:has-text('Sign out')").click();
    await page.waitForURL("**/login");
    await login(page, "jas@smi.local");
    await page.goto("/console/stories");
    const card = page.locator("div.rounded.border", { hasText: title }).first();
    await expect(card).toBeVisible();
    await card.locator("button:has-text('Approve')").click();
    await page.waitForTimeout(2000);

    // now public — formatting kept, injected markup rendered as harmless text
    await page.goto("/news");
    await page.locator(`text=${title}`).first().click();
    await expect(page.locator("h1", { hasText: title })).toBeVisible();
    await expect(page.locator(".story-body strong", { hasText: "Bold statement." })).toBeVisible();
    await expect(page.locator(".story-body", { hasText: "onerror" })).toBeVisible(); // literal text…
    await expect(page.locator('.story-body img[src="x"]')).toHaveCount(0); // …never an element
  });
});

test.describe("member equipment → approval (equipment write page)", () => {
  const machine = `E2E machine ${Date.now()}`;

  test("submitted machine reaches the console queue and publishes on approval", async ({ page }) => {
    await login(page, "member2@smi.local");
    await page.goto("/dashboard/equipment/new");
    await page.fill('input[name="name"]', machine);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("Nearly new demo unit. £100k depending on spec.");
    await page.click("button:has-text('Submit for approval')");
    await page.waitForURL("**/dashboard?submitted=machine");

    await page.goto("/dashboard");
    await page.locator("header form button:has-text('Sign out')").click();
    await page.waitForURL("**/login");
    await login(page, "jas@smi.local");
    await page.goto("/console/machines");
    await expect(page.locator("h2", { hasText: "Awaiting approval" })).toBeVisible();
    const row = page.locator("section div.rounded.bg-white", { hasText: machine });
    await row.locator("button:has-text('Approve')").click();
    const listRow = page.locator('a.flex[href^="/console/machines/"]', { hasText: machine });
    await expect(listRow.locator("span", { hasText: "published" })).toBeVisible();
  });
});

test.describe("admin block layouts (drag-and-drop, per-page override)", () => {
  test("blocks reorder by keyboard; removing ad slots affects only the overridden story", async ({ page }) => {
    await login(page, "jas@smi.local");

    // keyboard drag in the default story layout editor (dnd-kit keyboard sensor)
    await page.goto("/console/pages?type=story");
    const items = page.locator("ol li");
    const before = await items.allInnerTexts();
    const handle = page.locator('button[aria-label^="Move"]').first();
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true"); // sensor picked the block up
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(400); // keyboard sensor animates between positions
    await page.keyboard.press("Space");
    await expect
      .poll(async () => (await items.allInnerTexts()).join("|"))
      .not.toBe(before.join("|"));
    // don't save — the default layout stays untouched for the rest of the suite

    // create and publish a story via the admin WYSIWYG so the test owns its subject
    const overrideTitle = `E2E layout ${Date.now()}`;
    await page.goto("/console/stories/new");
    await page.fill('input[name="title"]', overrideTitle);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("Layout test body.");
    await page.click("button:has-text('Save')");
    await page.waitForURL(/\/console\/stories\/[0-9a-f-]+$/);
    const storyId = page.url().split("/").pop()!;
    await page.click("button:has-text('Publish now (urgent)')");
    await page.waitForURL("**/console/stories");

    // override this story's layout: remove every ad slot
    await page.goto(`/console/pages?type=story&entity=${storyId}`);
    const removeAd = page.locator('li:has-text("Advert slot") button[aria-label="Remove block"]');
    while ((await removeAd.count()) > 0) await removeAd.first().click();
    await page.click("button:has-text('Save layout')");
    await page.waitForURL("**saved=1**");

    // the overridden story renders no adverts; other stories keep the default's adverts
    await page.goto("/news");
    await page.locator(`a[href^="/news/"]`, { hasText: overrideTitle }).first().click();
    await expect(page.locator("h1", { hasText: overrideTitle })).toBeVisible();
    await expect(page.locator('a[aria-label^="Advert:"]')).toHaveCount(0);

    const otherLink = page.locator('a[href^="/news/"]:has(h3)').filter({ hasNotText: overrideTitle });
    await page.goto("/news");
    await otherLink.first().click();
    expect(await page.locator('a[aria-label^="Advert:"]').count()).toBeGreaterThan(0);

    // clean up: drop the override so reruns start from the default
    await page.goto(`/console/pages?type=story&entity=${storyId}`);
    await page.click("button:has-text('Remove this page')");
  });
});

test.describe("admin (A1/A4)", () => {
  test("command centre shows Needs You Today", async ({ page }) => {
    await login(page, "jas@smi.local");
    await page.goto("/console");
    await expect(page.locator("text=Needs you today")).toBeVisible();
  });

  test("command centre matches the wireframe structure", async ({ page }) => {
    await login(page, "jas@smi.local");
    await page.goto("/console");
    // revenue by stream with bars
    await expect(page.locator("text=Revenue this month")).toBeVisible();
    for (const stream of ["Memberships", "Advertising", "Featured member slots"]) {
      await expect(page.locator("section").filter({ hasText: "Revenue this month" }).locator(`text=${stream}`)).toBeVisible();
    }
    await expect(page.locator(`text=of 4 sold`)).toBeVisible();
    // pipeline strip links to the story engine
    await expect(page.locator('a[href="/console/stories"]', { hasText: "Story pipeline" })).toBeVisible();
    // nav: current module order first, active state on the current page
    // (the nav was reorganised after the original wireframe — Messages and
    // Analytics were added, and the engines grouped under CMS)
    const labels = await page.locator("header nav a").allTextContents();
    expect(labels.slice(0, 5)).toEqual([
      "Command Centre",
      "Messages",
      "Analytics",
      "CMS",
      "Adverts & Inventory",
    ]);
    await expect(page.locator('header nav a[aria-current="page"]')).toHaveText("Command Centre");
  });

  test("advert inventory lists live bookings with caps", async ({ page }) => {
    await login(page, "jas@smi.local");
    await page.goto("/console/adverts");
    await expect(page.locator("text=Live bookings")).toBeVisible();
    expect(await page.locator("td:has-text('live')").count()).toBeGreaterThan(0);
  });
});

test.describe("roles", () => {
  test("member cannot open the console", async ({ page }) => {
    await login(page, "member3@smi.local");
    await page.goto("/console");
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
  });
});
