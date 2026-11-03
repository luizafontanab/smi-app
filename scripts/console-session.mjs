// Dev utility: sign in as a seeded user and run a steps file against the local app.
// Usage: node scripts/console-session.mjs <email> <steps.mjs> [args...]
//
// The steps file default-exports an async function that receives
// { page, base, sql, args }:
//   page  a signed-in Playwright page (1280x1600)
//   base  http://127.0.0.1:3100
//   sql   (query) => string, run against the local database (psql -At, '|' separated)
//   args  the extra command-line arguments
//
//   export default async ({ page, base, sql, args: [id] }) => {
//     await page.goto(`${base}/console/stories/${id}`, { waitUntil: "networkidle" });
//     await page.click("button:has-text('Approve & publish now (urgent)')");
//     console.log(sql(`select status from stories where id = '${id}'`));
//   };
//
// Seeded logins share the password local-dev-password (see the run-smi-app skill).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [email, stepsFile, ...args] = process.argv.slice(2);
if (!email || !stepsFile) {
  console.error("Usage: node scripts/console-session.mjs <email> <steps.mjs> [args...]");
  process.exit(2);
}

const base = "http://127.0.0.1:3100";
const sql = (query) =>
  execFileSync("docker", ["exec", "supabase_db_app", "psql", "-U", "postgres", "-At", "-F|", "-c", query])
    .toString()
    .trim();

const { default: steps } = await import(pathToFileURL(resolve(stepsFile)).href);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "local-dev-password");
  await page.click("button:has-text('Sign in')");
  // admins land on /console, members on /dashboard
  await page.waitForURL(/\/(console|dashboard)/, { timeout: 20_000 });
  await steps({ page, base, sql, args });
} finally {
  await browser.close();
}
