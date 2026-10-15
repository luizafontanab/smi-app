// Build-time guard, not a runtime one: SUPABASE_SECRET_KEY is read at module
// scope below, so a `"use client"` anywhere in this module's import graph would
// otherwise inline it into a browser bundle with no error at all. This turns
// that into a failed build. Do not remove to "fix" an import error — fix the
// import.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./types";
import { MEDIA_PREFIX } from "../media-prefix";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
/** Browser-safe; grants the `anon` Postgres role, so RLS decides what it sees. */
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
/** Bypasses RLS entirely. Server-side only. */
const SECRET = process.env.SUPABASE_SECRET_KEY!;

/**
 * The `!` above is a type assertion only — nothing checks these at runtime, so a
 * missing variable surfaces as "supabaseKey is required" from inside
 * supabase-js, several frames from the cause. Name the variable instead.
 *
 * Note NEXT_PUBLIC_* are inlined at build time: they must exist wherever the
 * build runs (Vercel project env), not just at runtime.
 */
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set — the Supabase client cannot be created without it.`);
  return value;
}

/**
 * Log every failed PostgREST/Storage response.
 *
 * `src/lib/queries.ts` destructures `{ data }` and discards `error` on every
 * read — deliberately, so one bad query can't blank a whole page. The cost is
 * that a wrong project, a rotated key, a revoked grant or a dropped table all
 * render as *empty content*, identical to "nothing published yet", with nothing
 * in the server logs. That cost me a production diagnosis on 25 Sep: the site
 * came up blank, the error boundary never fired because nothing threw, and the
 * browser console held only an unrelated CSP warning.
 *
 * Wrapping fetch catches it at the transport layer — one place instead of ~60
 * call sites, and it cannot be forgotten by the next query that gets added.
 *
 * Note this sees transport and permission failures (401 bad key, 403/42501
 * revoked grant, 404 missing table). An RLS policy that matches no rows is a
 * legitimate 200 with `[]`, so it is correctly *not* an error here.
 */
const loggingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (!res.ok) {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let detail = "";
    try {
      detail = (await res.clone().text()).slice(0, 300);
    } catch {
      // body already consumed or not readable — the status alone is still useful
    }
    let where = href;
    try {
      where = new URL(href).pathname;
    } catch {
      // non-absolute URL; keep it as given
    }
    console.error(`[supabase] ${res.status} ${res.statusText} ${where} ${detail}`);
  }
  return res;
};

/** Publishable client — public-site reads as the `anon` role, restricted by RLS. */
export function publicDb() {
  return createClient<Database>(required(URL_, "NEXT_PUBLIC_SUPABASE_URL"), required(PUBLISHABLE, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false },
    global: { fetch: loggingFetch },
  });
}

/**
 * Secret-key client — bypasses RLS. Server-side only: console operations,
 * analytics writes, job runner. Never import from a client component.
 */
export function serviceDb() {
  return createClient<Database>(required(URL_, "NEXT_PUBLIC_SUPABASE_URL"), required(SECRET, "SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false },
    global: { fetch: loggingFetch },
  });
}

/** Session-aware client for the logged-in member/admin (RLS applies). */
export async function sessionDb() {
  const store = await cookies();
  return createServerClient<Database>(required(URL_, "NEXT_PUBLIC_SUPABASE_URL"), required(PUBLISHABLE, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (all) => {
        try {
          all.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component — session refresh is handled in proxy.ts
        }
      },
    },
  });
}

export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${MEDIA_PREFIX}${path}`;
}
