import { test } from "@playwright/test";

test("diagnose homepage geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/", { waitUntil: "networkidle" });
  const ads = page.locator('a[aria-label^="Advert:"]');
  const n = await ads.count();
  console.log(`viewport 1280x800, adverts: ${n}`);
  for (let i = 0; i < n; i++) {
    const box = await ads.nth(i).boundingBox();
    console.log(`  ad[${i}] ${await ads.nth(i).getAttribute("aria-label")} -> y=${box?.y} h=${box?.height} (bottom ${(box?.y ?? 0) + (box?.height ?? 0)})`);
  }
  const h3 = page.locator("h3").first();
  console.log(`first h3 "${(await h3.innerText()).slice(0, 30)}" -> y=${(await h3.boundingBox())?.y}`);
  console.log(`featured member cards: ${await page.locator("text=Featured member").count()}`);
});
