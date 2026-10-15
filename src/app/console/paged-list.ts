import "server-only";
import { mustList } from "@/lib/db/must";

/**
 * A counted, paged console list that survives a page past the end.
 *
 * PostgREST answers a `.range()` that starts beyond the last row with HTTP 416
 * (PGRST103, "Requested range not satisfiable") rather than an empty page, and
 * mustList — rightly — throws on any error, so /console/stories?view=list&page=999
 * (an old bookmark, a list that shrank after a delete, a hand-edited URL) took
 * the whole screen to the console error boundary. Here a past-the-end page is
 * re-run as the last page that exists, and the page actually shown is returned
 * so the pager agrees with the rows.
 *
 * `build` must apply the same filters and `{ count: "exact" }` every time it's
 * called — it's invoked once per attempt, because a PostgREST builder can only
 * be awaited once.
 */

type Query = PromiseLike<{ data: unknown; error: unknown }>;
/** As lib/db/must's: the success branch's `data`, so a list stays `Row[]`. */
type OkData<Q> = Q extends PromiseLike<infer R> ? (R extends { error: null; data: infer U } ? U : never) : never;

/** PostgREST's code for an offset beyond the last row (HTTP 416). */
const RANGE_NOT_SATISFIABLE = "PGRST103";

export function lastPage(count: number, size: number): number {
  return Math.max(1, Math.ceil(count / size));
}

export async function pagedList<Q extends Query>(
  build: (from: number, to: number) => Q,
  page: number,
  size: number,
  label: string,
): Promise<{ data: OkData<Q>; count: number; page: number }> {
  const want = Math.max(1, Math.floor(page) || 1);
  const first = await build((want - 1) * size, want * size - 1);
  if ((first.error as { code?: string } | null)?.code !== RANGE_NOT_SATISFIABLE) {
    // mustList for its throw-on-error, over the response already in hand.
    const { data, count } = await mustList(Promise.resolve(first), label);
    return { data: data as OkData<Q>, count: count ?? 0, page: want };
  }
  // Past the end: learn how many rows there are (offset 0 is always
  // satisfiable), then fetch the real last page.
  const { count: total } = await mustList(build(0, 0), label);
  const last = lastPage(total ?? 0, size);
  const { data, count } = await mustList(build((last - 1) * size, last * size - 1), label);
  return { data: data as OkData<Q>, count: count ?? 0, page: last };
}
