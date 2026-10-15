/**
 * Await a Supabase write and throw if it failed.
 *
 * supabase-js never throws on a rejected statement — it resolves to
 * `{ error }` — so a bare `await db.from(t).insert(rows)` that fails is
 * silent, and the seed carries on to print "Seed complete." over a database
 * missing those rows. That is how the dev-board rows went missing from every
 * local seed (dev_tasks.description/notes/context are NOT NULL, and the bulk
 * insert sent null for rows that left them out) without anyone seeing an error.
 *
 * Returns the result, so `.select()` reads keep their data.
 */
export async function must<T extends { error: { message: string } | null }>(what: string, query: PromiseLike<T>): Promise<T> {
  const result = await query;
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result;
}
