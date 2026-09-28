import { expect, test as base } from "@playwright/test";

/**
 * Signup is rate-limited to 3/hour per IP (`allowRequest("join", …)`), keyed
 * on the first x-forwarded-for entry — which is client-settable outside
 * Vercel's proxy by design. Give every test its own synthetic IP so repeated
 * local runs isolate from the limiter with zero production code change: the
 * limiter is a security control and must not grow a test-mode escape.
 */
let seq = 0;
const stamp = Date.now();
const test = base.extend({
  // second fixture param renamed from Playwright's conventional `use` —
  // eslint's react-hooks rule can't tell it apart from a React hook call.
  contextOptions: async ({ contextOptions }, provide) => {
    const n = (stamp + seq++ * 7919) % 0xffffff;
    await provide({
      ...contextOptions,
      extraHTTPHeaders: {
        ...contextOptions.extraHTTPHeaders,
        "x-forwarded-for": `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`,
      },
    });
  },
});

const PASSWORD = "local-dev-password";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  // members land on /dashboard — /member is the public directory
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
}

async function signOut(page: import("@playwright/test").Page) {
  // Sign out lives inside the header's account menu everywhere now
  await page.locator('header button[aria-label^="Account:"]').click();
  await page.locator("header form button:has-text('Sign out')").click();
  await page.waitForURL("**/login");
}

async function createAccount(page: import("@playwright/test").Page, company: string, email: string) {
  await page.goto("/join");
  await page.click("a:has-text('Join now')");
  await page.waitForURL("**/join/account");
  await page.fill('input[name="company"]', company);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Create account')");
  await page.waitForURL("**/dashboard/pay", { timeout: 20_000 });
}

test.describe("join funnel (V13 — account → pay → page → approval)", () => {
  test("marketing page states price and the four steps", async ({ page }) => {
    await page.goto("/join");
    await expect(page.locator("text=£40/month").first()).toBeVisible();
    for (const step of ["Create your account", "Pay £40/month", "Build your draft page", "We verify and approve"]) {
      await expect(page.locator(`text=${step}`).first()).toBeVisible();
    }
  });

  test("promo path end-to-end: signup → comp → page → jas activates", async ({ page }) => {
    test.setTimeout(120_000); // five-stage journey across two logins
    const ts = Date.now();
    const company = `E2E Join Ltd ${ts}`;
    const email = `e2e-join-${ts}@test.local`;
    // The test makes its own code rather than relying on SMI-FREE-YEAR, which
    // only scripts/seed.ts creates — a database seeded with seed-real.ts has
    // none, and this test then failed at step 2 with "Unknown promo code".
    const promo = `E2E-YEAR-${ts}`;

    await login(page, "jas@smi.local");
    await page.goto("/console/promo-codes");
    await page.fill('input[name="code"]', promo);
    await page.fill('input[name="months"]', "12");
    await page.click("button:has-text('Create code')");
    await page.waitForURL("**/console/promo-codes?saved=1");
    await signOut(page);

    await createAccount(page, company, email);

    // step 2: promo code
    await page.fill('input[name="promo"]', promo);
    await page.click("button:has-text('Pay £40/month')");
    await page.waitForURL("**/dashboard?submitted=paid");

    // checklist points at step 3
    await expect(page.locator("text=Finish setting up your membership")).toBeVisible();
    await page.click("a:has-text('Build your page')");
    await page.waitForURL("**/dashboard/profile");
    await expect(page.locator("text=Step 3 of 4")).toBeVisible();
    // description is a rich-text editor (contenteditable + hidden input)
    await page.locator('[contenteditable="true"]').first().click();
    await page.keyboard.type("We cut, fold and weld sheet metal.");
    await page.click("button:has-text('Submit page for approval')");
    await page.waitForURL("**/dashboard?submitted=page");
    await expect(page.locator("text=Jas is reviewing your page")).toBeVisible();
    await signOut(page);

    // jas: funnel chips + activate
    await login(page, "jas@smi.local");
    await page.goto(`/console/members?q=${encodeURIComponent(company)}`); // paginated list — search for the row
    const row = page.locator("tr", { hasText: company });
    await expect(row.getByText(/^comped → /)).toBeVisible();
    await expect(row.getByText("page ✓")).toBeVisible();
    await row.locator("button:has-text('Activate')").click();
    await expect(row.getByText("active", { exact: true })).toBeVisible();

    // funnel trail landed in the console (account, payment, page = 3 entries).
    // These are notifications, not messages, so since fix-list 71 they live
    // on /console/notifications — the Command Centre inbox is messages only.
    await page.goto("/console/notifications?category=notification");
    await expect(page.locator("li", { hasText: company })).toHaveCount(3);
  });

  test("abandon and resume: checklist highlights the pay step after re-login", async ({ page }) => {
    const ts = Date.now();
    const email = `e2e-resume-${ts}@test.local`;
    await createAccount(page, `E2E Resume Ltd ${ts}`, email);

    // abandon at the pay step
    await page.goto("/dashboard");
    await signOut(page);
    await login(page, email);
    await expect(page.locator("text=Finish setting up your membership")).toBeVisible();
    await expect(page.locator("a:has-text('Pay now')")).toBeVisible();
    await page.click("a:has-text('Pay now')");
    await page.waitForURL("**/dashboard/pay");
  });

  test("card-stub path records a paid invoice under billing", async ({ page }) => {
    const ts = Date.now();
    await createAccount(page, `E2E Card Ltd ${ts}`, `e2e-card-${ts}@test.local`);
    await page.click("button:has-text('Pay £40/month')"); // no promo → simulated card payment
    await page.waitForURL("**/dashboard?submitted=paid");
    await page.goto("/dashboard/settings/billing");
    await expect(page.locator("text=SMI-JOIN-").first()).toBeVisible();
  });

  test("unpaid draft cannot be activated (A17 gate)", async ({ page }) => {
    test.setTimeout(60_000);
    const ts = Date.now();
    const company = `E2E Gate Ltd ${ts}`; // must not contain chip words like "unpaid"
    await createAccount(page, company, `e2e-gate-${ts}@test.local`);
    await page.goto("/dashboard");
    await signOut(page);

    await login(page, "jas@smi.local");
    await page.goto(`/console/members?q=${encodeURIComponent(company)}`); // paginated list — search for the row
    const row = page.locator("tr", { hasText: company });
    await expect(row.getByText("unpaid", { exact: true })).toBeVisible();
    await expect(row.getByText("awaiting payment")).toBeVisible();
    await expect(row.locator("button:has-text('Activate')")).toHaveCount(0);
  });
});
