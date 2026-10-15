import { expect, test } from "./fixtures";

/**
 * Signed-out smoke. Every route here only reads — with one exception the guard
 * can't see: the pages that call requestContext() (home, news, member, video,
 * event, newsletters, industry, search, and their slug pages) bump the
 * aggregate consent counter once per view, even with essential-only consent
 * (src/lib/analytics.ts). A counter, not content or configuration.
 *
 * Deliberately absent: /visit/* and /go/* (click tracking writes), /unsubscribe
 * and /reset/new (their forms are the point of them).
 */

const PAGES = [
  "/",
  "/news",
  "/member",
  "/video",
  "/event",
  "/newsletters",
  "/industry/welding-joining",
  "/search?q=laser",
  "/contact",
  "/join",
  "/advertising",
];

for (const path of PAGES) {
  test(`${path} renders`, async ({ visit }) => {
    await visit(path);
  });
}

// No site chrome on the auth pages, so no main landmark — check the form instead.
for (const path of ["/login", "/reset"]) {
  test(`${path} renders its form`, async ({ page, visit }) => {
    await visit(path, { landmark: false });
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });
}

// Follow a real link rather than pinning a seed slug, so the check survives a reseed.
for (const [index, prefix] of [
  ["/news", "/news/"],
  ["/member", "/member/"],
]) {
  test(`the first ${prefix}<slug> linked from ${index} renders`, async ({ page, visit }) => {
    await visit(index);
    const href = await page.locator(`main a[href^="${prefix}"]`).first().getAttribute("href");
    expect(href, `${index} links to no ${prefix}<slug> page`).toBeTruthy();
    await visit(href!);
  });
}

test("metadata routes respond", async ({ request }) => {
  for (const [path, type] of [
    ["/robots.txt", "text/plain"],
    ["/sitemap.xml", "xml"],
    ["/manifest.webmanifest", "manifest+json"],
    ["/opengraph-image", "image/png"],
    ["/apple-icon", "image/png"],
  ]) {
    const res = await request.get(path);
    expect(res.status(), `${path}: HTTP status`).toBe(200);
    expect(res.headers()["content-type"], `${path}: content type`).toContain(type);
  }
});

// Two segments, so it misses the [slug] legacy-URL route and lands on the root
// not-found page, which touches no database at all.
test("an unknown URL gets the 404 page", async ({ page }) => {
  const res = await page.goto("/no-such/smoke-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /That page doesn.t exist/ })).toBeVisible();
});

for (const path of ["/console", "/dashboard"]) {
  test(`signed-out ${path} redirects to login`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(path)}`);
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });
}
