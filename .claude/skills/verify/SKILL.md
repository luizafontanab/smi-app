---
name: verify
description: Decide between a quick targeted check and the full `pnpm check` sweep, and run the right one. Use while iterating on a multi-step change, and always before calling a task done.
---

# Verifying changes

Two speeds. Use the cheap one while iterating, the full one once, at the end.

## Quick check (while iterating)

Between steps of a multi-step change, don't run a full typecheck/lint/test cycle — it's slow, and on this machine (often shared with other sessions) it dominates the wall clock without catching much the final run wouldn't. Instead:

- `pnpm lint <touched files>` — ESLint's flat config accepts file args, so this scopes to just what you edited.
- A targeted `grep`/`Read` to confirm the edit actually landed the way you intended.
- Editor/IDE diagnostics, if visible.

Skip straight to the full sweep only when a step is genuinely risky (a codemod across many files, a migration) — and even then, one targeted check, not the whole suite.

## Full sweep — `pnpm check`

Run once, when the task is otherwise done:

```bash
pnpm check   # typecheck (tsc --noEmit) && lint && vitest run
```

This is the thing to run before reporting a task complete. It's one command instead of three separate ones — no need to invoke `pnpm typecheck`, `pnpm lint`, and `pnpm test` by hand.

## When to go further

`pnpm check` deliberately excludes `build` and `test:e2e` — both are slow and have prerequisites, so they stay opt-in rather than part of the default sweep:

- **`pnpm build`** — for changes touching routing, env vars, or Next.js config. It catches build-time-only failures (static generation, route conflicts) that `tsc --noEmit` and unit tests won't. Mostly redundant with `check` otherwise.
- **`pnpm test:e2e`** — for UI/flow changes. Needs Supabase up and seeded and (usually) the dev server running on port 3100 — see the `run-smi-app` skill for getting that stack up before running it.
