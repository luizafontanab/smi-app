<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Known gaps

`docs/GAPS.md` is the standing audit of Phase 1 against `../requirements/USE-CASES.md`. Every item is numbered (A1.1, B2.1, C3 …) so it can be referenced directly. Check it before starting work in an area, and tick items off as they land.

`docs/HUMAN-TODO.md` is the companion list of steps only a person can take — external accounts, DNS, hosted-dashboard settings, decisions. When work is finished but inert because it needs a key, a domain or an approval, record it there rather than leaving it implied in a summary.

## Verifying changes

Use the `verify` skill (`.claude/skills/verify/SKILL.md`) while iterating and before calling any task done:

- **Mid-task, quick check** — after each meaningful edit: scoped `pnpm lint <touched files>`, a targeted grep/read to confirm the edit landed, and editor diagnostics if visible. Skip the full sweep here.
- **Before calling a task done, full sweep** — `pnpm check` (`tsc --noEmit && lint && vitest run`), plus `pnpm build` for routing/env/Next.js config changes, or `pnpm test:e2e` for UI/flow changes (needs the `run-smi-app` dev stack running).

### Visual regression is not part of any of that

`pnpm visual` (`tests/visual/`, see its README) screenshots every page and
compares against committed baselines. It is **human-triggered only** — never add
it to `pnpm check`, `pnpm test:e2e`, or CI, and don't run it unprompted: it takes
minutes and its baselines are machine-local.

It **never updates a baseline by itself**. A missing baseline is a hard failure
(exit 2), not a silent write. Only a person accepts a change, per route:
`pnpm visual:accept <route-id>`. Do not run `visual:accept --all` on someone's
behalf — accepting a baseline is asserting you looked at the picture.

## Don't restart what doesn't need it

The local dev server and Supabase are long-lived — leave them running across a session instead of cycling them per edit. See `.claude/skills/run-smi-app/SKILL.md` for full detail; in short:

- **Plain source edits** are already covered by Turbopack's HMR — no server restart needed. Only run `pnpm dev:stop` for an env var change, an edit to `next.config.ts`, or a new/updated dependency.
- `pnpm dev:start` is idempotent — it no-ops with "Already running" if the server's already up, so it's safe to call instead of checking first.
- **Supabase** (Docker) keeps its containers running between sessions — check it with the liveness line in the run-smi-app skill before assuming it needs starting, and apply a new migration with psql rather than a reset (step 2 of the `db-change` skill). `supabase db reset` drops the database — only when the data is actually wrong, and only with the user's say-so.
