---
name: run-smi-app
description: Launch and drive the SMI Next.js app locally — local Supabase stack, dev server on port 3100, seeded logins, and screenshotting routes. Use when asked to run, start, or screenshot the app, or to confirm a change works in the real app.
---

# Running the SMI app

Three moving parts. Only the first two are needed to look at a page.

1. **Supabase** (Postgres/Auth/Storage, Docker, ports `563xx`) — every page reads from it; without it the app boots but errors on data.
2. **`pnpm dev`** — Next.js 16 + Turbopack on **port 3100**.
3. **`scripts/job-runner.ts`** — the clock-driven jobs only (scheduled publishing, the daily sweeps). Member notifications no longer need it in dev — see Background jobs. Skip unless you're working on something time-based.

## Start

```bash
docker ps --filter name=supabase_db_app --format '{{.Status}}'   # "Up …"? then skip the next line
supabase start >/dev/null   # ~30s cold; leaves Docker containers running between sessions
pnpm dev:start              # idempotent: no-ops with "Already running" if it's already up
```

`supabase status` and `supabase start` print the stack's API keys, so the secrets hook blocks the first and asks about the second. The `docker ps` line is the liveness check; URLs and variable names are in `.env.example`.

`dev:start` (`scripts/dev-server.sh`) runs `next dev --turbopack -p 3100` detached, so it survives this session ending — don't use `run_in_background: true` for it, it isn't needed. It polls `http://127.0.0.1:3100/` itself and only returns once the server answers (or after ~60s if something's wrong), so the command finishing is your readiness signal — no separate curl loop to write.

Config comes from `.env.local` (gitignored, points at the local stack). `pnpm dev:logs` tails `.dev-server/dev.log`, which should show `- Environments: .env.local` — if that line is missing, the file is gone and every Supabase call will fail.

Port 3100 is fixed in `package.json` and in `playwright.config.ts`'s `baseURL`; don't move it. `dev:start` already refuses to spawn a second server if the port is occupied — it reports whatever's already listening (tracked or not) instead of starting a duplicate.

Only run `pnpm dev:stop` when something actually needs a fresh process: an env var change, an edit to `next.config.ts`, or a new/updated dependency. Plain source edits are already covered by Turbopack's HMR — no restart needed.

## Drive it

**Screenshot a route** — `scripts/screenshot.mjs` is the driver; Playwright's chromium is already installed as a dev dependency.

```bash
node scripts/screenshot.mjs /news shot.png
node scripts/screenshot.mjs / shot.png '[data-stage-card]'   # 3rd arg hovers first, then waits out the 520ms crossfade
```

1280×1600 viewport, `waitUntil: "networkidle"`. **Look at the PNG.** A blank or unstyled frame means the page threw, not that it rendered.

**Logins** — password `local-dev-password` for all seeded users:

| Email | Role |
|---|---|
| `jas@smi.local` | admin — `/console/*` |
| `media@smi.local` | member (external contributor) — `/dashboard/*`, drafts only |
| `member1@smi.local` … `member3@smi.local` | members — `/dashboard/*` |

**Act as a user** — `scripts/console-session.mjs` signs in and runs a steps file you write (put it in the scratchpad), handing it a signed-in `page` and a `sql` helper. The header comment shows the steps-file shape.

```bash
node scripts/console-session.mjs jas@smi.local steps.mjs <args...>
```

Use it for manual checks after a console change: click through the flow, then read the rows it should have written (`jobs`, `approvals`, the content table).

**Query the database** — the container's own `psql`, no connection string needed:

```bash
docker exec supabase_db_app psql -U postgres -At -F'|' -c "select status from stories limit 5"
```

**Route groups:** `/` and the public pages (`/member/*` is the PUBLIC directory), `/dashboard/*` (member area), `/console/*` (operator console). Anything under the latter two redirects to `/login` when signed out — a redirect there is correct behaviour, not a failure.

**Emails** don't leave the machine — Mailpit catches them at http://127.0.0.1:56324. Supabase Studio is at http://127.0.0.1:56323.

## Reseed

Only when the data is actually wrong, and only with the user's say-so — it drops the database. A new migration goes in without a reset: see step 2 of the `db-change` skill.

```bash
supabase db reset && docker restart supabase_kong_app && sleep 5 \
  && set -a && source .env.local && set +a && pnpm exec tsx scripts/seed.ts
```

The `docker restart supabase_kong_app` is not optional: Kong keeps stale connections after a reset and the seed fails without it. The seed fetches real stories from the live site (needs network) and synthesises everything else.

For real content instead of synthetic data, swap `scripts/seed.ts` for `scripts/seed-real.ts` (`pnpm seed:real`) — it reads a local WordPress export (`EXTRACT_DIR`, default `../handover-extract`) instead of hitting the network. It defaults to a representative 150 newest stories locally to keep the DB/Storage volume small; pass `--stories-limit N` to change that (only `--remote` runs, which target the real hosted project, default to the full set).

## Background jobs

`scripts/job-runner.ts` **refuses to start unless `CRON_SECRET` is set**, and it is not in `.env.local` by default. Any value works locally:

```bash
set -a && source .env.local && set +a && CRON_SECRET=local pnpm exec tsx scripts/job-runner.ts
```

**In development you mostly don't need it.** A job that is already due runs as soon as the response is sent (`runDueJobInlineInDev`, `src/lib/jobs.ts`), so a member notification and its email land immediately — the queue no longer looks like a no-op when the runner isn't up. Dev only; production leaves all of it to Vercel Cron, which currently runs once a day (HUMAN-TODO §13.1).

Two things it does *not* cover, and this is why the runner still exists:

- **Delayed jobs keep their delay.** `social_push` is enqueued at +30 minutes and dev does not shortcut that.
- **Time-based sweeps never self-trigger.** `publish_scheduled`, `comp_expiry`, `membership_lapse`, `advert_lifecycle`, `admin_digest` and the rest only fire from the runner. Without it a story scheduled for 10am stays scheduled.

## Tests

`pnpm test` (vitest, unit) needs nothing running. `pnpm test:e2e` (Playwright) starts its own dev server or reuses one already on 3100, but still needs Supabase up and seeded.
