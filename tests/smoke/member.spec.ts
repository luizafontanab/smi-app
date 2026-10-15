import { expect, MEMBER_STATE, test } from "./fixtures";

/**
 * Member-area smoke, as member1. Index pages only — every one of these reads
 * and renders; none writes on view. No forms are touched.
 */
test.use({ storageState: MEMBER_STATE });

const PAGES = [
  "/dashboard",
  "/dashboard/profile",
  "/dashboard/billing",
  "/dashboard/notifications",
  "/dashboard/stats",
  "/dashboard/submissions",
  "/dashboard/leads",
  "/dashboard/help",
  "/dashboard/resources",
  "/dashboard/settings",
];

for (const path of PAGES) {
  test(`${path} renders`, async ({ visit }) => {
    await visit(path);
  });
}

test("a member is kept out of the console", async ({ page }) => {
  await page.goto("/console");
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname).not.toMatch(/^\/console/);
});
