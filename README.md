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

GitHub org + repo transfer to SMI ownership · Supabase cloud (EU) + Vercel projects · Resend/Buffer/MaxMind keys · Stripe test wiring · real WP export import at cutover · newsletter deliverability test · Content OS (module 6, priced separately).
