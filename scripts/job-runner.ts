/** Local job runner: hits the cron route every 20s. Run: pnpm exec tsx scripts/job-runner.ts */
const URL_ = process.env.APP_URL ?? "http://127.0.0.1:3100";

async function tick() {
  try {
    const res = await fetch(`${URL_}/api/cron`);
    const body = await res.json();
    if (body.ran || body.failed) console.log(new Date().toISOString(), body);
  } catch (e) {
    console.error("cron tick failed:", e);
  }
}

console.log(`Job runner polling ${URL_}/api/cron every 20s — Ctrl-C to stop`);
tick();
setInterval(tick, 20_000);
