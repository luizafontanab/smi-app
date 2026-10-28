import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Automated WCAG 2.x A/AA scan over the key public pages. Serious/critical
 * violations fail the build — moderate/minor are reported in the failure
 * output but tolerated, so this stays a floor rather than a treadmill.
 */
// Bare /member is the word cloud now, so the tile list needs naming explicitly
// or it loses the coverage it had when it was the default view.
const PAGES = ["/", "/news", "/member", "/member?view=list", "/industry/welding-joining", "/join", "/login", "/contact", "/search"];

const PASSWORD = "local-dev-password";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
}

async function expectNoSeriousViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    serious,
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)\n  e.g. ${v.nodes[0]?.html}`).join("\n")
  ).toEqual([]);
}

for (const path of PAGES) {
  test(`axe: ${path} has no serious or critical violations`, async ({ page }) => {
    await page.goto(path);
    // let client components (cookie banner, hero) settle
    await page.waitForLoadState("networkidle");
    await expectNoSeriousViolations(page);
  });
}

// The forge design variant renders a different homepage composition, so the
// scan above — which runs on the default, grid — never sees it.
test("axe: / (forge variant) has no serious or critical violations", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "smi-theme", value: "forge", url: baseURL! }]);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expectNoSeriousViolations(page);
});

// Auth-walled surfaces: these never appeared in the public scan, which is
// exactly where unlabelled-control drift accumulated (2026-09 audit). Kept to
// the highest-traffic operator/member pages so the suite stays a floor.
// /console/leads earns a slot: a three-control search form plus three submit
// buttons per row is exactly the unlabelled-control shape this suite floors.
// /console/email-templates/[kind] earns a slot over its own list page: two
// monospace textareas, a token reference list, a sandboxed preview iframe and
// three separate submit buttons on one screen is the densest control cluster
// in the console.
// /console/advertising earns a slot for the same reason: seven file inputs, six
// aria-label-only text fields and six textareas, none of which has a visible
// <label> element — exactly where unlabelled-control drift hides.
// /console/notifications earns a slot: it is a new route, and its rows carry
// two link shapes plus per-row forms, which is where unlabelled-control drift
// shows up first.
// /console/sources earns a slot: a new route with a filter nav and several
// forms per row inside a <details> disclosure.
// /console/features earns a slot: a new route whose only controls are
// per-flag submit buttons named partly by visually hidden text.
const CONSOLE_PAGES = ["/console", "/console/stories", "/console/dev", "/console/newsletter", "/console/industries", "/console/leads", "/console/email-templates/welcome", "/console/advertising", "/console/notifications", "/console/releases", "/console/sources", "/console/adverts/featured-event", "/console/features"];
// /dashboard/submissions earns a slot: it gained status tabs, a <details>
// disclosure and an inline form per published row, which is exactly the shape
// unlabelled-control drift takes.
const DASHBOARD_PAGES = ["/dashboard", "/dashboard/story/new", "/dashboard/submissions", "/dashboard/profile", "/dashboard/leads", "/dashboard/advertising/assets"];

test.describe("axe: console (admin)", () => {
  for (const path of CONSOLE_PAGES) {
    test(`${path} has no serious or critical violations`, async ({ page }) => {
      // login + a data-heavy page + axe's in-page evaluate: the default 30s
      // trips on dev-server recompiles, not on real regressions
      test.setTimeout(90_000);
      await login(page, "jas@smi.local");
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoSeriousViolations(page);
    });
  }
});

test.describe("axe: dashboard (member)", () => {
  for (const path of DASHBOARD_PAGES) {
    test(`${path} has no serious or critical violations`, async ({ page }) => {
      test.setTimeout(90_000);
      await login(page, "member1@smi.local");
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoSeriousViolations(page);
    });
  }
});
