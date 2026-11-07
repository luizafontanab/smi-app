---
name: db-change
description: Add or alter a table, column, RLS policy or Postgres function — migration naming, the RLS invariant, regenerating db/types.ts, updating both seeds, and registering any new route. Use whenever a change touches supabase/migrations/.
---

# Changing the schema

A schema change is never just the migration. Nine of these steps are invisible in the diff
until something breaks — most often `src/lib/db/types.ts` drifting out of sync with the
database, or one of the two seeds not knowing about the new table.

## 1. Write the migration

Name it `YYYYMMDDNNNNNN_snake_case_topic.sql` **by hand**. Don't run `supabase migration
new` — it emits a 14-digit UTC timestamp that breaks the convention every one of the
existing files follows. The date is the authoring day; `NNNNNN` restarts at `000001` each
day, so check what's already there for today before picking a number:

```bash
ls supabase/migrations | tail -5
```

**Open with a prose `--` comment block** saying why, what it supersedes, and which
`docs/GAPS.md` item or `docs/fix-list.md` number it closes. Every migration in the tree
does this, and they're the only record of the reasoning —
`20260909000001_member_services.sql` is a good model: it explains the taxonomy confusion
it fixes, names the bug that caused it, and says why no rows are inserted.

**Every `create table` gets RLS in the same file.** This is currently 46 tables to 46
`enable row level security` statements, and keeping that ratio at 1:1 is the point — a
table that ships without it is readable by anon through PostgREST. Two idioms:

```sql
-- public data
alter table services enable row level security;
create policy public_read_services on services for select using (true);

-- console-managed data
alter table resources enable row level security;
-- no policies: console-managed, member area reads it via service role.
```

The comment on the second form is not decoration — RLS with no policies denies everything,
so without it the file looks like someone forgot to write the policy. `20260901000005_resources.sql`
is the model.

Three more rules:

- **New Postgres functions need `revoke execute … from public`.** Forgetting this once
  cost a follow-up migration, `20260816000002_revoke_maintenance_fns_from_public.sql`.
- **No `updated_at` triggers.** It's stamped by hand in the server action, by convention.
- **Never edit an applied migration** — add an idempotent follow-up instead. Destructive
  changes go constraint-drop → data remap → constraint-recreate with the reasoning inline;
  `20260902000001_dev_board_rework.sql` is the model.

## 2. Apply it locally

**Default: run the file straight into the running database.** It keeps the data, and other
sessions and worktrees sharing the local Supabase carry on undisturbed:

```bash
psql postgresql://postgres:postgres@127.0.0.1:56322/postgres -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql
```

This records nothing in Supabase's migration history, so a later reset (or another
session) may run the same file again. That's why the migration must be **idempotent**:
`create table if not exists`, `add column if not exists`, `drop policy if exists` before
`create policy`, `create or replace function`. Run it twice to prove it.

**Reset only with the user's say-so**, and only when the data is actually wrong. It drops
the database:

```bash
supabase db reset && docker restart supabase_kong_app && sleep 5 && pnpm seed
```

The Kong restart is not optional: it keeps stale connections after a reset and the seed
fails without it. See the `run-smi-app` skill for the full form with `.env.local` sourced.

## 3. Regenerate the types — don't hand-patch them

```bash
pnpm db:types
```

`src/lib/db/types.ts` is 2300 lines of generated output. It has been hand-patched in the
past (pasting in just the new table's block), which works right up until the day it
doesn't match the database and `tsc` starts vouching for a schema that isn't there.
Regenerate, then check the diff is only what you expect:

```bash
git diff --stat src/lib/db/types.ts
```

Reformatting churn or unrelated tables appearing in that diff means the file had already
drifted — worth mentioning rather than burying in the commit.

## 4. Update **both** seeds

`scripts/seed.ts` (synthetic) and `scripts/seed-real.ts` (WordPress export). A new table
almost always needs both. The header of `20260909000001_member_services.sql` documents a
bug that came from exactly this — the two seeds disagreeing about where services lived.

## 5. Wire it up

The shapes are stable; copy the nearest existing one rather than inventing.

- **Read path** — a new function in `src/lib/queries.ts`, using `publicDb()` for
  anon-visible data so RLS actually gets exercised.
- **Console writes** — a new `/* ---------- topic ---------- */` section in
  `src/app/console/actions.ts`. Fixed shape, per `saveResource`: `requireConsole()` → read
  `FormData` → validate and early-return → upload in a try/catch that redirects with
  `?error=` → `serviceDb()` → **hand-stamp `updated_at`** → `revalidatePath()` for *every*
  affected route (console *and* the public/member page that reads it) → `redirect("…?saved=1")`.
  Deletes require `formData.get("confirm") === "1"` and call `removeMedia(path)`.
- **Member writes** — `src/app/dashboard/actions.ts`, with `requireMember()` **plus** an
  explicit ownership guard (`assertOwnsRow` / `assertOwnsAdvert` / `assertOwnsBooking`).
  Server actions are reachable by direct POST, so the role check in the layout is not a
  substitute.

## 6. If you added a route, register it

Three lists are hardcoded and none of them fail loudly when a route is missing — drift
here is what the September 2026 audit caught:

| Where | What |
|---|---|
| `tests/e2e/a11y.spec.ts` | `PAGES`, `CONSOLE_PAGES`, `DASHBOARD_PAGES` — 13 routes today |
| `tests/visual/manifest.ts` | 12 pinned routes, each with a `pin:` provenance note |
| `src/app/sitemap.ts` | public routes only |

## 7. Close out

Tick the item in the right doc — see the `docs-bookkeeping` skill for which one and in what
format. Add tests (`tests/unit/queries.test.ts` for the read path, the matching
`console-actions-<domain>.test.ts` for the write path; see `test-patterns`).

Then `pnpm check`, plus `pnpm build` if routing or config moved.
