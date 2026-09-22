import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Turn a swallowed PostgREST error into a real failure.
 *
 * Console pages used to destructure only `{ data }` off a query, so a hard
 * backend failure rendered exactly like an empty result. That is how
 * /console/members came to show "Members (0)" against a production database
 * holding 123 members: the page embeds `industry:industries(name)`, the
 * `industries` table did not exist on that schema yet, PostgREST rejected the
 * whole request with PGRST200, and `data`/`count` came back null. An operator
 * could not tell a broken screen from an empty one.
 *
 * Throwing is deliberate: src/app/console/error.tsx is already mounted, so a
 * throw lands in the console error boundary with the nav intact and a digest
 * to quote, rather than needing a hand-written banner on all ~40 screens.
 *
 * A missing row is NOT an error here. `.single()` reports one as PGRST116, so
 * a page whose miss is a legitimate 404 should use `.maybeSingle()` — that
 * returns `{ data: null, error: null }` and passes straight through. Reserve
 * `.single()` for rows whose absence really is a broken invariant.
 */

/** Any awaited PostgREST response: a success/failure union of `{ data, error }`. */
type Query = PromiseLike<{ data: unknown; error: unknown }>;

/**
 * The `data` type of the response's SUCCESS branch — the one where `error` is
 * null. Distributing over that union is what keeps each terminal method honest:
 * a list yields `Row[]`, `.single()` yields `Row`, and `.maybeSingle()` yields
 * `Row | null`, because a maybeSingle miss is a success carrying no row.
 *
 * Do not reach for supabase's own `QueryData<T>` here — it applies
 * `Exclude<U, null>`, which would strip exactly that legitimate null and leave
 * every `if (!row) notFound()` narrowing to `never`.
 */
type OkData<Q> = Q extends PromiseLike<infer R>
  ? R extends { error: null; data: infer U } ? U : never
  : never;

function fail(label: string, error: PostgrestError): never {
  const parts = [error.code, error.message].filter(Boolean).join(" ");
  const extra = [error.details, error.hint].filter(Boolean).join(" — ");
  throw new Error(`[${label}] Supabase query failed: ${parts}${extra ? ` (${extra})` : ""}`);
}

/**
 * Await a query and return its `data`, throwing if PostgREST reported an error.
 *
 *   const member = await must(db.from("members").select("id, name").eq("id", id).maybeSingle(), "console/members detail");
 */
export async function must<Q extends Query>(query: Q, label: string): Promise<OkData<Q>> {
  const { data, error } = await query;
  if (error) fail(label, error as PostgrestError);
  return data as OkData<Q>;
}

/**
 * As `must`, but keeps the `count` that paginated console lists need.
 *
 *   const { data, count } = await mustList(q.range(from, to), "console/members list");
 */
export async function mustList<Q extends Query>(
  query: Q,
  label: string,
): Promise<{ data: OkData<Q>; count: number | null }> {
  const result = await query;
  if (result.error) fail(label, result.error as PostgrestError);
  const { count } = result as { count?: number | null };
  return { data: result.data as OkData<Q>, count: count ?? null };
}
