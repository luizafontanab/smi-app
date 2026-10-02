import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * The error log's own service client — deliberately NOT serviceDb().
 *
 * serviceDb() routes every request through loggingFetch, which reports failed
 * responses. Once loggingFetch reports into the error log (Phase 2), writing
 * the log through serviceDb() would mean a failing database reports its own
 * failure through the failing database, forever. Plain `fetch` here breaks
 * that loop by construction: a failure writing the log is the end of the line,
 * and src/lib/log.ts falls back to the console for it.
 *
 * Returns null rather than throwing when the env is missing — the logger must
 * never be the thing that fails.
 */
export function logDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, { auth: { persistSession: false }, global: { fetch } });
}
