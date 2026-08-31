# SMI Website Rebuild — Phase 1 (local build)

Custom rebuild of sheetmetalindustries.com: public site, member area, operator console, advert engine, and platform layer. Requirements live in [`../requirements/`](../requirements/); Next.js 16 conventions and local quirks in [`docs/nextjs16-notes.md`](docs/nextjs16-notes.md).

## Run locally

```bash
supabase start                 # Postgres/Auth/Storage on ports 563xx (see supabase/config.toml); no-op if already running
pnpm dev:start                 # detached Next.js dev server on http://127.0.0.1:3100; no-op if already running
pnpm exec tsx scripts/job-runner.ts   # optional: background jobs (publishing, notifications)
```

`pnpm dev:start` runs `next dev --turbopack` detached from the current terminal, logging to `.dev-server/dev.log` (gitignored) — it keeps running after the terminal closes, so there's no need to keep a foreground window open or restart it between sessions. `pnpm dev:logs` tails the log, `pnpm dev:status` reports whether it's up, and `pnpm dev:stop` shuts it down. Only actually stop/restart it for an env var change, a `next.config.ts` edit, or a new/updated dependency — Turbopack's HMR already picks up source file edits live. Plain `pnpm dev` in the foreground still works too, if you'd rather have it tied to your terminal.

First-time / reset seed (real stories fetched from the live site + synthetic everything else):

```bash
supabase db reset && docker restart supabase_kong_app && sleep 5 \
  && set -a && source .env.local && set +a && pnpm exec tsx scripts/seed.ts
```

**Logins** (password `local-dev-password`): `jas@smi.local` (admin) · `media@smi.local` (member, draft-only) · `member1..3@smi.local` (members).

## Deploy to hosted Supabase

Current project: `smi-app`, ref `kgjnwyojgajcvsberods`, region `ca-central-1`. ⚠ Interim — [TECH-DECISIONS](../requirements/TECH-DECISIONS.md) #6 requires an EU/UK region and a project's region is fixed at creation, so a London project replaces this one before launch. That re-run is why the steps below are scripted.

Credentials live in `.env.production.local` (gitignored). Create it from the dashboard's API keys:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
SUPABASE_SECRET_KEY=sb_secret_…
```

The same three names must be set in Vercel — `NEXT_PUBLIC_*` are inlined at build time, so adding them requires a redeploy before they take effect.

### Other environment variables

| Variable | Required? | Effect if unset |
|---|---|---|
| `CRON_SECRET` | **Yes in production** | `/api/cron` fails closed and returns 503 — **no background job runs at all** (scheduled publishing, comp expiry, daily rollups, and the analytics partition top-up that rides on them). Vercel injects `Authorization: Bearer $CRON_SECRET` on its own cron requests once this is set on the project. Set it locally too, or `scripts/job-runner.ts` refuses to start. |
| `ADMIN_EMAIL` | Recommended | Admin notification emails are skipped with a logged warning. Enquiries and funnel events still land in the console inbox, so nothing is lost — but nobody is told. Has no fallback on purpose: the old `jas@smi.local` default bounced silently. |
| `SITE_URL` | Optional | Falls back to the deployment's own origin (`VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`, then localhost). Set it once there is a real domain, so `sitemap.xml`, `robots.txt`, canonical/OG tags **and every link in an outgoing email** use it. Read at request time — no rebuild needed. |
| `RESEND_API_KEY` | **Yes in production** | No mail is sent. Falls back to local Mailpit when `MAILPIT_URL` is set, otherwise a console log. Nothing is lost — member notifications are also rows in `notifications` — but nobody is told anything: no approvals, no advert notices, no password reset. When it **is** set the sender throws on a provider rejection, so a bad key or unverified domain surfaces as a dead job in "Needs You Today" instead of failing silently. |
| `EMAIL_FROM` | Optional | Defaults to `SMI <noreply@sheetmetalindustries.com>`. Point staging at its own verified subdomain so a mistake there cannot damage the production domain's sending reputation. |
| `EMAIL_REPLY_TO` | Recommended | Replies go to the no-reply address, i.e. nowhere. A member answering "your advert needs a change" reaches no one. |
| `RESEND_SEGMENT_ID` | Needed for the newsletter | The newsletter falls back to the logging stub even with a key set (and says so). Issues are not marked sent. |
| `RESEND_WEBHOOK_SECRET` | Needed for the newsletter | `/api/webhooks/resend` fails closed with 503, so unsubscribes and spam complaints made at Resend's end never reach our `contacts` table and the list silently goes stale. |
| `MAILPIT_URL` | Dev only | The dev sender logs instead of delivering. From `supabase status`. |
| `BUFFER_ACCESS_TOKEN` | Optional | Adapter falls back to a logging stub (`src/lib/adapters/`). |

A full template with commentary lives in [`.env.example`](.env.example).

### ⚠ Cron runs once a day — revisit before launch

The schedule in [`vercel.json`](vercel.json) is `0 3 * * *` (03:00 daily). **Vercel's Hobby plan only permits once-daily crons**, and the plan for this project is unconfirmed, so the safe schedule was chosen deliberately for the demo rather than the one the code wants.

What that costs, until it changes:

- **Scheduled stories publish up to 24h late.** `ensurePeriodic` queues `publish_scheduled` every 60s (`src/lib/jobs.ts`), but nothing drains the queue between nightly runs. An editor scheduling a story for 09:00 sees it go live at 03:00 the following morning.
- `social_push` and `notify_member` are equally delayed; `crm_sync` (15m) and `comp_expiry`/`rollup_daily` (24h) are fine on a daily tick.
- Analytics partitions are still topped up nightly by `run_daily_rollup`, so the ~1-month partition cliff is covered.

**Before launch:** confirm the Vercel plan. On Pro, set `*/5 * * * *` (or `* * * * *` to match what the code assumes) and scheduled publishing becomes near-real-time. On Hobby, either upgrade or accept daily publishing and say so to Jas — "schedule a story for Tuesday 9am" is a stated editorial expectation.

A project also carries a deprecated `anon`/`service_role` JWT pair (dashboard → **Legacy API keys**) that maps to the same two roles: `publishable` = `anon`, `secret` = `service_role`. supabase-js accepts either format, but the new keys revoke independently — rotating a leaked `service_role` key means rotating the project JWT secret, which signs out every user at once.

```bash
supabase link --project-ref <ref>   # no DB password needed; the CLI provisions a temp login role
pnpm db:push:prod                   # applies supabase/migrations in order
pnpm seed:prod --stories-limit 300  # real WP content; --remote guard is baked into the script
```

Then in the dashboard: **Authentication → URL Configuration** → set Site URL + redirect URLs to the deployed app.

- **New Postgres functions are callable by `anon` unless you revoke from `PUBLIC`.** Two things grant it: migration 0006's `alter default privileges … grant execute on functions to anon, authenticated`, and Postgres's own default of granting `EXECUTE` to `PUBLIC` at creation. `revoke … from anon, authenticated` alone does **not** work — the roles still inherit through `PUBLIC`. Any maintenance or `security definer` function needs `revoke execute on function f() from public;` plus an explicit `grant … to service_role;` (see `20260816000002`).
- **Never run `supabase config push`.** It would overwrite hosted auth settings with the local values in `config.toml` — `site_url = 127.0.0.1:3000`, `enable_confirmations = false`, and a 2-emails/hour rate limit.
- The seed expects a **fresh database** — it uses plain `.insert()`, so a second run collides. Re-deploy by resetting the remote schema, not by re-seeding.
- `--stories-limit N` bounds the media upload too (only media referenced by seeded rows is uploaded). All 1,992 stories = 1.00 GiB, exactly the free-tier storage cap; 300 stories ≈ 306 MiB. Members/videos/events contribute a fixed 164 MiB regardless.
- The `media` bucket is created by the seed script, not by a migration — a schema-only deploy leaves prod with no bucket and every image 404ing.
- `seed-real.ts` leaves analytics, newsletters, and contacts empty by design; those console panels render as real-but-empty. Run `seed.ts` instead when demoing them.

## Tests

```bash
pnpm lint && pnpm test        # eslint + vitest (rotation fairness, unsubscribe permanence)
pnpm test:e2e                 # playwright (approval-gate loop, member-first search, roles)
```

## Architecture notes

- **Advert neutrality is structural**: selection is an unbiased shuffle in `src/lib/adverts.ts`; the schema has no weight/priority column and must never gain one.
- **Approval gate**: no code path publishes content without editor action; RLS keeps non-published rows invisible to the public role.
- **Integrations** are adapters with working local stubs (`src/lib/adapters/`): email (Resend), social (Buffer), CRM (Bigin), newsletter (**Resend** — the MailChimp deliverability gate was closed in its favour on 31 Aug; TECH-DECISIONS #7 superseded), IP→company (region-first GeoLite2), payments (Stripe). Real wiring lands per-service as credentials/decisions arrive.
- **Jobs**: Postgres queue (`jobs` table) driven by `/api/cron` (Vercel Cron in prod, `scripts/job-runner.ts` locally). Dead-lettered jobs surface in the console's "Needs You Today".
- **Analytics**: first-party, partitioned `analytics_events` + nightly rollups. Numbers shown to members are real — no padding, by requirement.

## Still parked (needs approval / external accounts)

GitHub org + repo transfer to SMI ownership · **Supabase EU/UK project** (deployed to `ca-central-1` for the demo — see above) · Vercel project + Cron (`/api/cron` is unauthenticated unless `CRON_SECRET` is set) · **Resend account (SMI-owned) + verified sending domain with SPF/DKIM/DMARC, plus Resend SMTP set in the hosted Supabase dashboard for auth mail** · Buffer/MaxMind keys · Stripe test wiring · real WP export import at cutover · Content OS (module 6, priced separately).
