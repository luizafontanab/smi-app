/** Local job runner: hits the cron route every 20s. Run: pnpm exec tsx scripts/job-runner.ts */
const URL_ = process.env.APP_URL ?? "http://127.0.0.1:3100";

// /api/cron fails closed, so the runner must present the same secret Vercel
// Cron sends in production. Put CRON_SECRET in .env.local and source it.
const SECRET = process.env.CRON_SECRET;
if (!SECRET) {
  console.error("CRON_SECRET is not set — /api/cron will refuse every tick.");
  console.error("Add it to .env.local, then: set -a && . ./.env.local && set +a");
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(`${URL_}/api/cron`, { headers: { authorization: `Bearer ${SECRET}` } });
    const body = await res.json();
    if (body.ran || body.failed || body.error) console.log(new Date().toISOString(), body);
  } catch (e) {
    console.error("cron tick failed:", e);
  }
}

console.log(`Job runner polling ${URL_}/api/cron every 20s — Ctrl-C to stop`);
tick();
setInterval(tick, 20_000);
