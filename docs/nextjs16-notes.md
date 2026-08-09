# Next.js 16.3 — project conventions (digest of bundled docs)

Full docs: `node_modules/next/dist/docs/01-app/`. This digest covers what differs from Next 14/15 habits. **This project uses the default caching model (NOT `cacheComponents`)** — at ~2k visitors/mo we render dynamically and stay always-fresh; fetch/data is uncached by default which is what we want.

## Must-know deltas

- **`params`, `searchParams`, `cookies()`, `headers()` are Promise-only.** Always `await` them. `const { slug } = await props.params`. Typegen helpers exist globally: `PageProps<'/news/[slug]'>`, `LayoutProps<'/'>`, `RouteContext<'/api/x/[id]'>`.
- **`proxy.ts`, not `middleware.ts`** (root or `src/`). Export `proxy` (or default). Node runtime only — do NOT set `runtime`. Without `matcher` it runs on _next/static too. `skipProxyUrlNormalize` is the renamed flag. Static redirects belong in `next.config.ts` `redirects()`, proxy only when request data is needed.
- **Turbopack is default for dev AND build.** No custom webpack config (build fails). Config key is top-level `turbopack`.
- **`revalidateTag(tag, 'max')`** — two args required. `updateTag(tag)` only inside Server Actions. `refresh()` (next/cache) refreshes client router only.
- **`next lint` is gone**; `next build` doesn't lint. Run `pnpm lint` (eslint CLI) separately.
- **Image**: `priority` deprecated → `preload` (or `loading="eager"`/`fetchPriority="high"`). `images.qualities` default `[75]`. Remote images need `images.remotePatterns`. Local src with query string needs `images.localPatterns.search`.
- **error.tsx**: prop is `retry` (16.3+), not `reset`. Error boundaries are client components.
- **Route handlers**: not cached by default; only GET can opt in via `export const dynamic = 'force-static'`. Fetch memoization does NOT apply inside them. `export const runtime = 'edge'` is deprecated — never use it.
- **Server actions**: `'use server'` files; with `useActionState` the action's first param is prevState. Always auth-check inside every server function (they're reachable by direct POST). Cookie set in an action re-renders the tree.
- Parallel route `@slot` folders require `default.tsx` or the build fails.
- `next.config.ts` (TS) is standard. `typedRoutes: true` is stable top-level.
- `generateStaticParams` must return an array; child params typing via `Awaited<LayoutProps<'/x/[y]'>['params']>`.
- `AGENTS.md`/`CLAUDE.md` in app/ are managed by `next dev` — commit them, don't fight them.

## Caching idioms for this app (default model)

- Pages that read cookies/searchParams/DB are dynamic automatically — fine.
- Advert slot selection is per-request random → pages showing adverts are dynamic by design.
- For rare static-ish data (categories list): `unstable_cache(fn, key, { revalidate: 3600 })` or just query every request — traffic is tiny; prefer simple.

## Local runbook quirks

- After `supabase db reset`, the Kong gateway caches the old storage container IP → storage API returns "invalid response from upstream server". Fix: `docker restart supabase_kong_app` (our project's container only — other Supabase projects run on this machine; never touch theirs).
- Re-seed: `supabase db reset && docker restart supabase_kong_app && sleep 5 && set -a && source .env.local && set +a && pnpm exec tsx scripts/seed.ts`
- Logins: jas@smi.local (super_admin), media@smi.local (input_only), member1..3@smi.local (members) — password `local-dev-password`.
