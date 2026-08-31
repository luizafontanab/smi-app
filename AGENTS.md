<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Known gaps

`docs/GAPS.md` is the standing audit of Phase 1 against `../requirements/USE-CASES.md`. Every item is numbered (A1.1, B2.1, C3 …) so it can be referenced directly. Check it before starting work in an area, and tick items off as they land.

## Verifying changes

Use the `verify` skill (`.claude/skills/verify/SKILL.md`) while iterating and before calling any task done:

- **Mid-task, quick check** — after each meaningful edit: scoped `pnpm lint <touched files>`, a targeted grep/read to confirm the edit landed, and editor diagnostics if visible. Skip the full sweep here.
- **Before calling a task done, full sweep** — `pnpm check` (`tsc --noEmit && lint && vitest run`), plus `pnpm build` for routing/env/Next.js config changes, or `pnpm test:e2e` for UI/flow changes (needs the `run-smi-app` dev stack running).

## Don't restart what doesn't need it

The local dev server and Supabase are long-lived — leave them running across a session instead of cycling them per edit. See `.claude/skills/run-smi-app/SKILL.md` for full detail; in short:

- **Plain source edits** are already covered by Turbopack's HMR — no server restart needed. Only run `pnpm dev:stop` for an env var change, an edit to `next.config.ts`, or a new/updated dependency.
- `pnpm dev:start` is idempotent — it no-ops with "Already running" if the server's already up, so it's safe to call instead of checking first.
- **Supabase** (Docker) keeps its containers running between sessions — check with `supabase status` before assuming it needs starting, and never `supabase db reset` unless the data is actually wrong or a migration just landed (it drops the database).
