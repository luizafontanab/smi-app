import { serviceDb } from "@/lib/db/server";
import { logError } from "./log";

/** Longest chain we will follow. Renames are rare; anything deeper is a bug. */
const MAX_HOPS = 5;

export type ResolvedRedirect = { to: string; permanent: boolean };

/**
 * Resolve a stored redirect, following chains and refusing to loop.
 *
 * Both guards matter. A member renamed acme → acme-ltd and then back leaves
 * BOTH rows in place, because renames only ever wrote rows and never removed
 * them. While the member is active that is invisible (the live slug resolves
 * first), but the moment they go lapsed or draft, each slug misses and the two
 * rows point at each other — an infinite redirect instead of a 404. Chains
 * (a → b → c) are the same problem one step out: without following them, an
 * old link lands on a URL that itself 404s.
 *
 * `redirects` has RLS on with no public policy, so this uses the service key.
 * It only ever runs on a lookup miss, never on the hot path.
 */
export async function resolveRedirect(fromPath: string): Promise<ResolvedRedirect | null> {
  const db = serviceDb();
  const seen = new Set<string>([fromPath]);
  let current = fromPath;
  let result: ResolvedRedirect | null = null;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const { data } = await db
      .from("redirects")
      .select("to_path, status_code")
      .eq("from_path", current)
      .maybeSingle();
    if (!data) break;

    if (seen.has(data.to_path)) {
      // A cycle. Sending the reader round it forever is strictly worse than a
      // 404, and a 308 would bake that loop into their browser cache.
      logError({ source: "server", area: "redirects:cycle", error: new Error("redirect cycle detected"), context: { at: current, to: data.to_path } });
      return null;
    }
    seen.add(data.to_path);
    current = data.to_path;
    // 301/308 are permanent; 302/307 are not. Default the column's own default.
    result = { to: data.to_path, permanent: data.status_code !== 302 && data.status_code !== 307 };
  }

  return result;
}

/**
 * Record a rename, and drop the row that would close a loop.
 *
 * Renaming a → b while a row b → a exists (the "undo a typo" sequence) is
 * exactly how the cycle above gets created, so the reverse row is deleted in
 * the same breath. Chains are also flattened: anything that pointed at the old
 * path is repointed at the new one, so an old link still lands in one hop.
 */
export async function recordRename(fromPath: string, toPath: string): Promise<void> {
  if (fromPath === toPath) return;
  const db = serviceDb();

  // the destination must not itself redirect somewhere, or the new URL 404s
  await db.from("redirects").delete().eq("from_path", toPath);
  await db.from("redirects").upsert({ from_path: fromPath, to_path: toPath, status_code: 301 });
  // flatten existing chains that ended at the old path
  await db.from("redirects").update({ to_path: toPath }).eq("to_path", fromPath).neq("from_path", toPath);
}
