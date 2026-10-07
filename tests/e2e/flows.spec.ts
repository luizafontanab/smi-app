import { expect, test } from "@playwright/test";
import sharp from "sharp";

const PASSWORD = "local-dev-password";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  // members land on /dashboard (the member area) — /member is the public directory
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
}

/** For assertions about forge's own structure — grid is the default design. */
async function pinForge(context: import("@playwright/test").BrowserContext, baseURL: string | undefined) {
  await context.addCookies([{ name: "smi-theme", value: "forge", url: baseURL! }]);
}

test.describe("reader (V1/V2)", () => {
  // Forge-only: the hero rail is forge's, and grid's top slot is a sold banner by design.
  test("homepage renders news-first with rotating adverts", async ({ page, context, baseURL }) => {
    await pinForge(context, baseURL);
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
    // scoped to the filtered All-news grid — the rails above it are unfiltered
    await page.locator('[data-testid="all-news-grid"] a[href^="/news/"]:has(h3)').first().click();
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

test.describe("member directory — cloud view", () => {
  test("/member opens on the cloud, and the list is one click away", async ({ page }) => {
    await page.goto("/member");
    await expect(page.locator("#member-cloud")).toBeVisible();
    await expect(page.getByRole("link", { name: "Cloud", exact: true })).toHaveAttribute("aria-current", "true");

    await page.getByRole("link", { name: "List", exact: true }).click();
    await page.waitForURL(/view=list/);
    await expect(page.locator("#member-cloud")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "List", exact: true })).toHaveAttribute("aria-current", "true");
  });

  test("the cloud shows every match at once, while the list still pages", async ({ page }) => {
    await page.goto("/member");
    const total = Number((await page.getByText(/^\d+ members?/).textContent())!.match(/\d+/)![0]);
    // The whole point of the view: a word map of one page of twelve is not one.
    expect(await page.locator("li.cloud-item").count()).toBe(total);

    await page.goto("/member?view=list");
    expect(await page.locator("a[href^='/member/']").count()).toBeLessThan(total);
  });

  test("hovering a name reveals its logo without moving the page", async ({ page }) => {
    await page.goto("/member");
    // The cloud repacks itself once the real font metrics are known, and eases
    // into the correction — measure after that, or this test races the settle
    // rather than the thing it is about.
    await page.locator("#member-cloud-refined").waitFor({ state: "attached" });
    await page.waitForTimeout(900); // the 700ms settle transition

    const item = page.locator("li.cloud-item").first();
    const card = item.locator(".cloud-card");
    await expect(card).toHaveCSS("opacity", "0");

    // A word map that reflowed on hover would be unusable — this is the
    // requirement most likely to regress silently, so pin a neighbour. Pick a
    // non-drifting one: the largest names carry an ambient drift by design.
    const neighbour = page.locator("li.cloud-item:not([data-drift])").first();
    // Measured against the cloud, not the viewport: hover() scrolls the target
    // into view, so a viewport-relative box changes by the scroll distance and
    // would fail this for a reason that has nothing to do with reflow.
    const position = () =>
      neighbour.evaluate((el) => {
        const cloud = document.getElementById("member-cloud")!.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return { dx: Math.round(r.left - cloud.left), dy: Math.round(r.top - cloud.top), w: Math.round(r.width) };
      });

    const before = await position();
    await item.locator(".cloud-name").hover();
    await expect(card).toHaveCSS("opacity", "1");
    expect(await position()).toEqual(before);
  });

  test("the logo is reachable by keyboard, not just by mouse", async ({ page }) => {
    await page.goto("/member");
    const item = page.locator("li.cloud-item").first();
    await item.locator(".cloud-name").focus();
    await expect(item.locator(".cloud-card")).toHaveCSS("opacity", "1");
  });

  test("filters apply to the cloud and names link through", async ({ page }) => {
    await page.goto("/member");
    await page.getByRole("navigation", { name: "Filter by industry" }).getByRole("link").nth(1).click();
    await page.waitForURL(/\/member\?industry=/);
    const total = Number((await page.getByText(/^\d+ members?/).textContent())!.match(/\d+/)![0]);
    expect(await page.locator("li.cloud-item").count()).toBe(total);

    const first = page.locator("li.cloud-item a[href^='/member/']").first();
    const href = await first.getAttribute("href");
    expect(href).toMatch(/^\/member\/[^/]+$/); // no trailing slash
    await first.click();
    await page.waitForURL(href!);
  });

  test("an empty result still says so in the cloud view", async ({ page }) => {
    // Cloud is the default, so this message can no longer live in the list branch.
    await page.goto("/member?q=zzzznosuchmemberzzzz");
    await expect(page.getByText("No members found.")).toBeVisible();
    await expect(page.locator("li.cloud-item")).toHaveCount(0);
  });
});

test.describe("member directory — industry pills + text search", () => {
  test("the industry pills filter the directory", async ({ page }) => {
    await page.goto("/member");
    const pills = page.getByRole("navigation", { name: "Filter by industry" });
    // "All industries" plus one per industry — 10 in the dev seed
    const links = pills.getByRole("link");
    expect(await links.count()).toBeGreaterThan(1);

    const pill = links.nth(1);
    const label = (await pill.textContent())!.trim();
    await pill.click();
    await page.waitForURL(/\/member\?industry=/);
    await expect(page.getByText(new RegExp(`in ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeVisible();
  });

  test("Escape closes the services panel and returns focus to the trigger", async ({ page }) => {
    await page.goto("/member");
    const trigger = page.getByRole("button", { name: "Services", exact: true });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });

  test("industry and search term survive each other", async ({ page }) => {
    await page.goto("/member");
    const name = (await page.locator('a[href^="/member/"]').filter({ hasText: /\w/ }).first().textContent())!.trim();
    const term = name.split(/\s+/)[0];

    // pick an industry first — the form's hidden field must carry it through the search
    await page.getByRole("navigation", { name: "Filter by industry" }).getByRole("link").nth(1).click();
    await page.waitForURL(/industry=/);
    const chosen = new URL(page.url()).searchParams.get("industry")!;

    await page.getByRole("searchbox", { name: "Search members" }).fill(term);
    await page.keyboard.press("Enter");
    await page.waitForURL(/q=/);
    expect(new URL(page.url()).searchParams.get("industry")).toBe(chosen);

    // and the reverse: clearing the industry keeps q
    await page.getByRole("link", { name: "All industries" }).click();
    await page.waitForURL((u) => !u.searchParams.has("industry"));
    expect(new URL(page.url()).searchParams.get("q")).toBe(term);
  });

  test("the legacy ?category= param still filters (external links must not die)", async ({ page }) => {
    // /industry/[slug] linked here as ?category= before migration 20260909000002.
    await page.goto("/member?industry=welding");
    const viaIndustry = (await page.getByText(/\d+ members? in /).textContent())!.trim();
    await page.goto("/member?category=welding");
    await expect(page.getByText(/\d+ members? in /)).toHaveText(viaIndustry);
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
  // Pinned to forge for the page-level checks: they expect forge's navy join
  // band, which hides for signed-in visitors. Grid's homepage band shows to
  // everyone. The header itself is one structure on both designs
  // (site-header.test.tsx covers the light tone).
  test.beforeEach(async ({ context, baseURL }) => pinForge(context, baseURL));

  test("anonymous visitors get the join/login pair", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: "Become a Member", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Login" })).toBeVisible();
    // and the navy CTA band is still there for them
    await expect(page.getByRole("main").getByRole("link", { name: "Become a Member", exact: true })).toBeVisible();
  });

  test("signed-in member gets the account menu with member links, and no join CTA", async ({ page }) => {
    await login(page, "member2@smi.local");
    // the member area header shows the company name — that's what the public header should echo
    const company = (await page.getByTestId("member-name").textContent())!.trim();

    await page.goto("/");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: "Become a Member", exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "Login" })).toHaveCount(0);
    const trigger = header.getByRole("button", { name: `Account: ${company}` });
    await expect(trigger).toBeVisible();

    // the navy "Become a Member" band is gone for signed-in visitors too
    await expect(page.getByRole("link", { name: "Become a Member", exact: true })).toHaveCount(0);

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(header.getByRole("link", { name: "Notifications" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Help" })).toBeVisible();
    await header.getByRole("link", { name: "Member area" }).click();
    await page.waitForURL("**/dashboard");
  });

  test("console user gets console entries in the account menu, not member ones", async ({ page }) => {
    await login(page, "jas@smi.local");
    await page.goto("/");
    const header = page.locator("header").first();
    const trigger = header.getByRole("button", { name: "Account: Jas" });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(header.getByRole("link", { name: "Admin console" })).toHaveAttribute("href", "/console");
    await expect(header.getByRole("link", { name: "Help" })).toHaveCount(0);
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
    // Nine navigations across two logins — legitimately ~50s on the dev
    // server, so triple the budget rather than trim the coverage.
    test.slow();
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
    // a cover is mandatory for member stories (fix list item 32) — the input's
    // `required` would otherwise block the submit below at the browser
    await page.setInputFiles('input[name="cover"]', {
      name: "cover.jpg",
      mimeType: "image/jpeg",
      buffer: await sharp({ create: { width: 1200, height: 675, channels: 3, background: { r: 51, g: 65, b: 85 } } }).jpeg().toBuffer(),
    });

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

    // sign out (from the member area header's account menu), editor approves
    await page.goto("/dashboard");
    await page.locator('header button[aria-label^="Account:"]').click();
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

  // The dashboard card for /dashboard/equipment/new is hidden (fix list item 9)
  // but the route is deliberately still live — this covers the whole
  // machine-approval pipeline, which the console still uses.
  test("submitted machine reaches the console queue and publishes on approval", async ({ page }) => {
    await login(page, "member2@smi.local");
    await page.goto("/dashboard/equipment/new");
    await page.fill('input[name="name"]', machine);
    await page.locator('[contenteditable="true"]').click();
    await page.keyboard.type("Nearly new demo unit. £100k depending on spec.");
    await page.click("button:has-text('Submit for approval')");
    await page.waitForURL("**/dashboard?submitted=machine");

    await page.goto("/dashboard");
    await page.locator('header button[aria-label^="Account:"]').click();
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
    // Scoped to the block editor: the page also carries the homepage-sections
    // card (GAPS A1.7), whose list and "Move … up" buttons come first.
    const editor = page.getByRole("list", { name: "Page blocks" });
    const items = editor.locator("li");
    const before = await items.allInnerTexts();
    const handle = editor.locator('button[aria-label^="Move"]').first();
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
    // A save lands on the editor with ?saved=1 since fix-list 73 — take the id
    // from the path, not the last URL segment.
    await page.waitForURL(/\/console\/stories\/[0-9a-f-]+(\?saved=1)?$/);
    const storyId = new URL(page.url()).pathname.split("/").pop()!;
    await page.click("button:has-text('Publish now (urgent)')");
    await page.waitForURL("**/console/stories");

    // override this story's layout: remove every ad slot
    await page.goto(`/console/pages?type=story&entity=${storyId}`);
    const removeAd = page.locator('li:has-text("Advert slot") button[aria-label="Remove block"]');
    while ((await removeAd.count()) > 0) await removeAd.first().click();
    await page.click("button:has-text('Save layout')");
    await page.waitForURL("**saved=1**");

    // the overridden story renders no adverts; other stories keep the default's
    // adverts. Navigate by href rather than clicking the card — a click racing
    // /news hydration is occasionally swallowed under the runner's tracing
    // overhead (flake), and click-through from /news is already covered by the
    // WYSIWYG test above.
    await page.goto("/news");
    const overrideHref = await page
      .locator(`a[href^="/news/"]`, { hasText: overrideTitle })
      .first()
      .getAttribute("href");
    await page.goto(overrideHref!);
    await expect(page.locator("h1", { hasText: overrideTitle })).toBeVisible();
    await expect(page.locator('a[aria-label^="Advert:"]')).toHaveCount(0);

    await page.goto("/news");
    // Not just "not this run's story": any "E2E layout" story may still carry an
    // override from an earlier run that died before its clean-up, and one of
    // those made this assertion fail for reasons unrelated to the code.
    const otherHref = await page
      .locator('a[href^="/news/"]:has(h3)')
      .filter({ hasNotText: "E2E layout" })
      .first()
      .getAttribute("href");
    await page.goto(otherHref!);
    await expect(page.locator("h1")).toBeVisible(); // story page rendered…
    await expect(page.locator('a[aria-label^="Advert:"]').first()).toBeVisible(); // …with its adverts

    // clean up: drop the override so reruns start from the default. Wait for
    // the page to say so — the click used to be the test's last line, so the
    // browser could close before the server action ran and the override lived on.
    await page.goto(`/console/pages?type=story&entity=${storyId}`);
    await page.click("button:has-text('Remove this page')");
    await expect(page.getByText("currently using the default")).toBeVisible();
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
    // (the nav was reorganised after the original wireframe — Analytics was
    // added, the engines grouped under Content, and Messages moved to the
    // header bell)
    const labels = await page.locator("header nav a").allTextContents();
    expect(labels.slice(0, 5)).toEqual([
      "Command Centre",
      "Analytics",
      "Content",
      "Adverts & Inventory",
      "Members & CRM",
    ]);
    await expect(page.locator('header nav a[aria-current="page"]')).toHaveText("Command Centre");
  });

  test("advert inventory lists live bookings with caps", async ({ page }) => {
    await login(page, "jas@smi.local");
    await page.goto("/console/adverts");
    await expect(page.locator("text=Live bookings")).toBeVisible();
    expect(await page.locator("td:has-text('live')").count()).toBeGreaterThan(0);
    // banners are one sitewide pool, counted against the spots we sell
    await expect(page.getByText(/^\d+ of \d+$/).first()).toBeVisible();
    await page.goto("/console/adverts/spots");
    await expect(page.getByRole("heading", { name: "Banner spots" })).toBeVisible();
    await expect(page.getByLabel("Spots we sell")).toHaveValue(/^\d+$/);
    await expect(page.getByText("Positions on the site")).toHaveCount(0);
  });
});

test.describe("roles", () => {
  test("member cannot open the console", async ({ page }) => {
    await login(page, "member3@smi.local");
    await page.goto("/console");
    await page.waitForURL("**/dashboard", { timeout: 15_000 });
  });
});
