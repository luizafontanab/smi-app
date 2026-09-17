---
name: test-patterns
description: Write a unit test that matches the ~120 existing ones and fails for the right reason — the Supabase stubs, the redirect signal, jsdom for component tests, and which file a new test belongs in. Use when adding or fixing anything under tests/unit/.
---

# Writing unit tests here

The stubs under `tests/stubs/` are documented in their own docstrings — **read the stub
before writing against it**, they're better than any summary. This covers what isn't in
them: the conventions around them, and the ways a test here passes without testing
anything.

## The failure mode to avoid

A badly-wired test doesn't fail — it returns `null` from an unstubbed table and asserts
happily on nothing. The stubs are built to prevent that, so don't defeat them:

- **`fromByTable()` throws on an unconfigured table.** That's deliberate. When a test hits
  it, the fix is to configure the table, not to add a `fallback` to silence it. Pass a
  fallback only for code that touches many tables and genuinely only cares about a few.
- **`asDb()` is the one sanctioned cast site.** Build with `mockDb()`, pass through `asDb()`.
  Never `as unknown as SupabaseClient` inline — that's how a fake drifts from the real
  client shape without anyone noticing.
- **`resetDbServerMocks()` goes in `afterEach`**, or return values leak between tests in the
  same file and the second test passes because of the first.
- **`tests/setup.ts` hard-throws in CI without `SUPABASE_SECRET_KEY`.** Several suites are
  `describe.skipIf(!KEY)` — including the two webhook suites covering the highest-risk
  unauthenticated routes. If CI trips that error the answer is to give CI the key, never to
  loosen the check; a silent skip makes a green run meaningless.

Canonical wiring to copy: `tests/unit/queries.test.ts:1-24` — the local `db()` helper points
`publicDb()` and `serviceDb()` at one table-routed fake in three lines.

## Testing a server action that redirects

Every action ends in `redirect()`. `next/navigation` is aliased globally in
`vitest.config.ts` to `tests/stubs/next-navigation.ts`, which throws an identifiable
`RedirectSignal` instead of Next's internal digest — so the redirect **is** the assertion:

```ts
await expect(requireConsole()).rejects.toThrow("NEXT_REDIRECT:/login?next=/console");
```

`next/headers` and `next/cache` are aliased the same way, so `cookies()`, `headers()` and
`revalidatePath()` all work in a plain unit test. No per-file `vi.mock` needed for these.

Separately, genuinely pure logic still gets extracted into `src/lib/*.ts` and tested with a
bare `FormData` — `src/lib/dev-tasks.ts` is the model. Prefer that when the logic is worth
naming on its own; it isn't a workaround for the redirect, which is assertable either way.

## Component tests

`vitest.config.ts` sets `environment: "node"` for the whole project, so **every `.tsx` test
needs the docblock on line 1** — all 41 of them have it:

```ts
// @vitest-environment jsdom
```

RTL's `cleanup` is wired manually in `tests/setup.ts` (globals are off, so auto-cleanup
doesn't self-register). Don't add another one.

## Where the test goes

- Read-path query → add to `tests/unit/queries.test.ts`.
- Console action → the matching `tests/unit/console-actions-<domain>.test.ts`
  (`stories`, `videos`, `events`, `members`, `machines`, `devtasks`, `newsletter-crm`,
  `advert-artwork`, `advert-bookings`, `misc`). Add to the domain file rather than starting
  a new one.
- Anything else → `kebab-case.test.ts` alongside its peers, matching the module it covers.

## Timeouts

`testTimeout` is 30s, not vitest's 5s default — several suites are integration tests against
Supabase in Docker, whose latency was measured between 0.05s and 8.3s for the same
single-row statement. Pure unit files finish in milliseconds regardless, so don't shorten it
locally to make a hang show up faster.

## Before calling it done

`pnpm test` needs nothing running; the `skipIf` suites need Supabase up. Then the `verify`
skill for the full sweep.
