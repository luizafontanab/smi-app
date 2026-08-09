import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./types";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Anonymous client — public-site reads, restricted by RLS. */
export function publicDb() {
  return createClient<Database>(URL_, ANON, { auth: { persistSession: false } });
}

/**
 * Service-role client — bypasses RLS. Server-side only: console operations,
 * analytics writes, job runner. Never import from a client component.
 */
export function serviceDb() {
  return createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } });
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
