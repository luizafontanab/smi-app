import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./types";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

/** Anonymous client — public-site reads, restricted by RLS. */
export function publicDb() {
  return createClient<Database>(required(URL_, "NEXT_PUBLIC_SUPABASE_URL"), required(ANON, "NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
  });
}

/**
 * Service-role client — bypasses RLS. Server-side only: console operations,
 * analytics writes, job runner. Never import from a client component.
 */
export function serviceDb() {
  return createClient<Database>(required(URL_, "NEXT_PUBLIC_SUPABASE_URL"), required(SERVICE, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

/** Session-aware client for the logged-in member/admin (RLS applies). */
export async function sessionDb() {
  const store = await cookies();
  return createServerClient<Database>(URL_, ANON, {
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
  return `${URL_}/storage/v1/object/public/media/${path}`;
}
