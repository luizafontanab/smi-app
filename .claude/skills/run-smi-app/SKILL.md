---
name: run-smi-app
description: Launch and drive the SMI Next.js app locally — local Supabase stack, dev server on port 3100, seeded logins, and screenshotting routes. Use when asked to run, start, or screenshot the app, or to confirm a change works in the real app.
---

# Running the SMI app

Three moving parts. Only the first two are needed to look at a page.

1. **Supabase** (Postgres/Auth/Storage, Docker, ports `563xx`) — every page reads from it; without it the app boots but errors on data.
2. **`pnpm dev`** — Next.js 16 + Turbopack on **port 3100**.
3. **`scripts/job-runner.ts`** — optional background jobs (scheduled publishing, notifications). Skip unless the change touches jobs.

## Start

```bash
supabase status        # already up? then skip the next line
supabase start         # ~30s cold; leaves Docker containers running between sessions
pnpm dev               # background it — see below
```

Run the dev server backgrounded (`run_in_background: true`), then poll until it answers rather than sleeping a fixed amount:

```bash
for i in $(seq 1 60); do
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/ | grep -qE "^[23]" && echo READY && break
  sleep 1
done
```

Ready in well under a second on a warm cache; the first request compiles the route and takes ~2s.

Config comes from `.env.local` (gitignored, points at the local stack). `next dev` prints `- Environments: .env.local` — if that line is missing, the file is gone and every Supabase call will fail.

Port 3100 is fixed in `package.json` and in `playwright.config.ts`'s `baseURL`; don't move it. If it's occupied, that's usually a dev server from an earlier session — reuse it instead of starting a second.

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
| `jas@smi.local` | super admin — `/console/*` |
| `media@smi.local` | input-only operator |
| `member1@smi.local` … `member3@smi.local` | members — `/dashboard/*` |

Sign in at `/login` (`input[name="email"]`, `input[name="password"]`); `tests/e2e/flows.spec.ts` has the helper if you need it in a script.

**Route groups:** `/` and the public pages (`/member/*` is the PUBLIC directory), `/dashboard/*` (member area), `/console/*` (operator console). Anything under the latter two redirects to `/login` when signed out — a redirect there is correct behaviour, not a failure.

**Emails** don't leave the machine — Mailpit catches them at http://127.0.0.1:56324. Supabase Studio is at http://127.0.0.1:56323.

## Reseed

Only when the data is wrong or a migration landed — it drops the database.

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

Without it, scheduled publishing and notification jobs simply never run — pages stay in the state the seed left them.

## Tests

`pnpm test` (vitest, unit) needs nothing running. `pnpm test:e2e` (Playwright) starts its own dev server or reuses one already on 3100, but still needs Supabase up and seeded.
