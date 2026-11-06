# Coding standards

Rules a reviewer can check against a diff. Each one says why it exists.

- **[hard]** means a violation is a defect. Flag it.
- **[preferred]** means a judgement call. Flag it as a suggestion.

Anything ESLint (`eslint-config-next` core-web-vitals + typescript) or `tsc` already
enforces is left out. Don't re-report what tooling catches.

Longer background lives in the linked sources. Where this file and a source disagree,
fix whichever is wrong rather than picking one silently.

## Server actions and auth

- **[hard] Every server action checks auth itself, first.** Console actions call
  `requireConsole()`, member actions call `requireMember()` (both in `src/lib/auth.ts`).
  *Why:* actions are reachable by direct POST, so a role check in the layout protects
  nothing.
- **[hard] Member actions that touch a row also check ownership.** Use the guards in
  `src/app/dashboard/actions.ts` (`assertOwnsMachine`, `assertOwnsAdvert`,
  `assertOwnsBooking`, `assertOwnsMark`), or add one in the same style.
  *Why:* `requireMember()` proves who you are, not that the row is yours.
- **[hard] A `"use server"` file exports only async functions.** `export type` is fine; a
  non-exported `const` is fine; `export const LIST = [...]` is not.
  *Why:* it passes `pnpm check` and then throws at runtime on every page that imports the
  module. Only `pnpm build` catches it.
- **[preferred] Console write actions follow the fixed shape.** `requireConsole()` → read
  `FormData` → validate and early-return → upload in try/catch redirecting with `?error=` →
  `serviceDb()` → stamp `updated_at` by hand → `revalidatePath()` for *every* affected
  route (console and public/member) → `redirect("…?saved=1")`. Deletes require
  `formData.get("confirm") === "1"` and call `removeMedia(path)`.
  *Why:* a missed `revalidatePath` leaves a stale public page; the shape makes gaps obvious.
  Source: `.claude/skills/db-change/SKILL.md` §5.

## Database

Full procedure: `.claude/skills/db-change/SKILL.md`.

- **[hard] Never edit a migration that has been applied.** Add an idempotent follow-up.
- **[hard] Every `create table` enables RLS in the same migration.** Public data gets a
  `select using (true)` policy; console-managed data gets no policies *and a comment
  saying so*.
  *Why:* a table without RLS is readable by anon through PostgREST.
- **[hard] New Postgres functions `revoke execute … from public`.**
- **[hard] `src/lib/db/types.ts` is regenerated (`pnpm db:types`), never hand-edited.**
  A diff to it with no matching migration is a red flag.
- **[hard] A new table updates both seeds**, `scripts/seed.ts` and `scripts/seed-real.ts`.
- **[preferred] Migration names are `YYYYMMDDNNNNNN_snake_case_topic.sql`** and open with a
  `--` comment saying why and which GAPS/fix-list item they close.
- **[preferred] No `updated_at` triggers.** Stamp it in the server action.
- **[preferred] Anon-visible reads use `publicDb()`** so RLS is exercised; `serviceDb()`
  is for console/member writes and server-only reads.

## Next.js 16 (differs from older habits)

Source: `docs/nextjs16-notes.md`.

- **[hard] `await` `params`, `searchParams`, `cookies()` and `headers()`.** They are
  Promises.
- **[hard] Request interception lives in `src/proxy.ts`.** No `middleware.ts`, and no
  `runtime` export on it.
- **[hard] No `export const runtime = 'edge'`** anywhere.
- **[hard] `error.tsx` boundaries take `retry`, not `reset`.**
- **[hard] `revalidateTag` takes two arguments** (`revalidateTag(tag, 'max')`).
- **[hard] No custom webpack config.** Turbopack builds dev and prod.
- **[preferred] `next/image` uses `preload`, not the deprecated `priority`.**
- **[preferred] Prefer simple, uncached queries.** Traffic is small; reach for
  `unstable_cache` only for rare static-ish data. This project does not use
  `cacheComponents`.

## Errors and logging

Source: `docs/logging.md`.

- **[preferred] Log caught failures with `logError()` from `src/lib/log.ts`**, not bare
  `console.error`. Use `recordError()` only when the write must be awaited.
- **[hard] Never log an email, IP address or raw secret into error context.** The scrubber
  is a backstop, not a licence.
- **[hard] Errors are never shown in Jas's console.** Error views are developer-only.

## Tests

Source: `.claude/skills/test-patterns/SKILL.md`.

- **[hard] New behaviour comes with a unit test.** Read paths go in
  `tests/unit/queries.test.ts`; console actions in the matching
  `tests/unit/console-actions-<domain>.test.ts`.
- **[hard] Don't defeat the Supabase stubs.** No `fallback` added just to silence
  `fromByTable()`; no inline `as unknown as SupabaseClient` (use `asDb()`);
  `resetDbServerMocks()` in `afterEach`.
- **[hard] `.tsx` tests start with `// @vitest-environment jsdom`.**
- **[hard] Never loosen the CI `SUPABASE_SECRET_KEY` check** or add `skipIf` to get a green
  run.
- **[hard] `workers: 1` in `playwright.config.ts` stays.** E2E runs serially against the
  dev server on purpose.
- **[preferred] A new route is registered** in `tests/e2e/a11y.spec.ts`,
  `tests/visual/manifest.ts` (if pinned) and `src/app/sitemap.ts` (public routes).
  *Why:* none of these lists fail when a route is missing.

## Docs that ship with the change

- **[hard] Every user-visible change adds an entry to `src/content/release-notes.md`.**
  *Why:* it's how Jas learns what changed (console "What's new").
  `tests/unit/release-notes.test.ts` checks the format.
- **[preferred] Finished work is closed in the right doc** (`docs/GAPS.md`,
  `docs/HUMAN-TODO.md`, `docs/fix-list.md` …). Only `fix-list.md` keeps `[x]` ticks; the
  others collapse finished items into a Closed/Done line. Source:
  `.claude/skills/docs-bookkeeping/SKILL.md`.
- **[preferred] A decision that's hard to reverse gets an ADR** in `docs/adr/`.

## Domain decisions that code must respect

- **[hard] Nothing posts to social channels without a per-channel confirmation**, and a
  change to the built post invalidates that confirmation. Source:
  `docs/adr/0001-social-posts-need-per-channel-confirmation.md`.
