import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Automated WCAG 2.x A/AA scan over the key public pages. Serious/critical
 * violations fail the build — moderate/minor are reported in the failure
 * output but tolerated, so this stays a floor rather than a treadmill.
 */
const PAGES = ["/", "/news", "/member", "/join", "/login", "/contact", "/search"];

for (const path of PAGES) {
  test(`axe: ${path} has no serious or critical violations`, async ({ page }) => {
    await page.goto(path);
    // let client components (cookie banner, hero) settle
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");

    expect(
      serious,
      serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)\n  e.g. ${v.nodes[0]?.html}`).join("\n")
    ).toEqual([]);
  });
}
