import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every object key in a bucket, walked recursively.
 *
 * Supabase Storage has no recursive list, and the seed gives each story its own
 * folder (`stories/<slug>/cover.png`), so a bucket of ~2,600 files is ~2,600
 * folder listings. Done sequentially that takes long enough to blow a ten-minute
 * timeout against a remote project — measured, not guessed. The listings are
 * independent, so this walks them with bounded concurrency instead.
 *
 * `concurrency` is deliberately modest: the point is to stop being serial, not
 * to open a thousand sockets at a hosted project and get rate-limited.
 */
export async function listAllObjects(
  db: SupabaseClient,
  bucket: string,
  concurrency = 16,
): Promise<Set<string>> {
  const found = new Set<string>();
  const queue: string[] = [""];
  let active = 0;

  /** List one prefix, collecting files into `found` and returning its subfolders. */
  const listPrefix = async (prefix: string): Promise<string[]> => {
    const folders: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`storage list "${prefix}": ${error.message}`);
      if (!data?.length) break;
      for (const entry of data) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        // A folder placeholder comes back with a null id; real objects carry one.
        if (entry.id === null) folders.push(full);
        else found.add(full);
      }
      if (data.length < 1000) break;
    }
    return folders;
  };

  await new Promise<void>((resolve, reject) => {
    let failed = false;
    const pump = () => {
      if (failed) return;
      if (!queue.length && active === 0) {
        resolve();
        return;
      }
      while (queue.length && active < concurrency) {
        const prefix = queue.shift()!;
        active++;
        listPrefix(prefix).then(
          (folders) => {
            queue.push(...folders);
            active--;
            pump();
          },
          (err) => {
            failed = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          },
        );
      }
    };
    pump();
  });

  return found;
}
