/**
 * Reads every row a query matches, a page at a time. PostgREST silently caps a
 * response at `max_rows` (1000, supabase/config.toml), so an unpaged read of a
 * growing table starts dropping rows one day without an error — the directory
 * facets (GAPS A9.1) and the member stats page's trends (A9.2 finding) both
 * read tables that grow that way.
 *
 * `page` must order deterministically, or rows can repeat or skip across pages.
 * Prefer counting in SQL when only a number is needed; this is for when the
 * rows themselves are.
 */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>, size = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data } = await page(from, from + size - 1);
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}
