# SMI Website Rebuild — Phase 1 (local build)

Custom rebuild of sheetmetalindustries.com: public site, member area, operator console, advert engine, and platform layer. Requirements live in [`../requirements/`](../requirements/); Next.js 16 conventions and local quirks in [`docs/nextjs16-notes.md`](docs/nextjs16-notes.md).

## Run locally

```bash
supabase start                 # Postgres/Auth/Storage on ports 563xx (see supabase/config.toml)
pnpm dev                       # app on http://127.0.0.1:3100
pnpm exec tsx scripts/job-runner.ts   # optional: background jobs (publishing, notifications)
```

First-time / reset seed (real stories fetched from the live site + synthetic everything else):

```bash
supabase db reset && docker restart supabase_kong_app && sleep 5 \
  && set -a && source .env.local && set +a && pnpm exec tsx scripts/seed.ts
```

**Logins** (password `local-dev-password`): `jas@smi.local` (super admin) · `media@smi.local` (input-only) · `member1..3@smi.local` (members).

## Deploy to hosted Supabase

Current project: `smi-app`, ref `kgjnwyojgajcvsberods`, region `ca-central-1`. ⚠ Interim — [TECH-DECISIONS](../requirements/TECH-DECISIONS.md) #6 requires an EU/UK region and a project's region is fixed at creation, so a London project replaces this one before launch. That re-run is why the steps below are scripted.

Credentials live in `.env.production.local` (gitignored). Create it from the dashboard's API keys:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
SUPABASE_SECRET_KEY=sb_secret_…
```

The same three names must be set in Vercel — `NEXT_PUBLIC_*` are inlined at build time, so adding them requires a redeploy before they take effect.

A project also carries a deprecated `anon`/`service_role` JWT pair (dashboard → **Legacy API keys**) that maps to the same two roles: `publishable` = `anon`, `secret` = `service_role`. supabase-js accepts either format, but the new keys revoke independently — rotating a leaked `service_role` key means rotating the project JWT secret, which signs out every user at once.

```bash
supabase link --project-ref <ref>   # no DB password needed; the CLI provisions a temp login role
pnpm db:push:prod                   # applies supabase/migrations in order
pnpm seed:prod --stories-limit 300  # real WP content; --remote guard is baked into the script
```

Then in the dashboard: **Authentication → URL Configuration** → set Site URL + redirect URLs to the deployed app.

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
- **Integrations** are adapters with working local stubs (`src/lib/adapters/`): email (Resend), social (Buffer), CRM (Bigin), newsletter (undecided — deliverability gate), IP→company (region-first GeoLite2), payments (Stripe). Real wiring lands per-service as credentials/decisions arrive.
- **Jobs**: Postgres queue (`jobs` table) driven by `/api/cron` (Vercel Cron in prod, `scripts/job-runner.ts` locally). Dead-lettered jobs surface in the console's "Needs You Today".
- **Analytics**: first-party, partitioned `analytics_events` + nightly rollups. Numbers shown to members are real — no padding, by requirement.

## Still parked (needs approval / external accounts)

GitHub org + repo transfer to SMI ownership · **Supabase EU/UK project** (deployed to `ca-central-1` for the demo — see above) · Vercel project + Cron (`/api/cron` is unauthenticated unless `CRON_SECRET` is set) · Resend/Buffer/MaxMind keys · Stripe test wiring · real WP export import at cutover · newsletter deliverability test · Content OS (module 6, priced separately).
