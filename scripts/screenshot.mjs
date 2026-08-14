// Dev utility: screenshot a route. Usage: node scripts/screenshot.mjs <path> <outfile> [hoverSelector]
// The optional third argument hovers something first, so hover-only states (the
// home hero's stage promotion) can be captured.
import { chromium } from "playwright";
const [path = "/", out = "shot.png", hover] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1600 } });
await p.goto(`http://127.0.0.1:3100${path}`, { waitUntil: "networkidle" });
if (hover) {
  await p.hover(hover);
  await p.waitForTimeout(900); // let the 520ms crossfade settle
}
await p.screenshot({ path: out });
await b.close();
