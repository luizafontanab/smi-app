// Dev utility: screenshot a route. Usage: node scripts/screenshot.mjs <path> <outfile>
import { chromium } from "playwright";
const [path = "/", out = "shot.png"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1600 } });
await p.goto(`http://127.0.0.1:3100${path}`, { waitUntil: "networkidle" });
await p.screenshot({ path: out });
await b.close();
