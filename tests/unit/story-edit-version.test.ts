import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * editStory's optimistic-concurrency check uses `stories.updated_at` exactly
 * as PostgREST returned it to the edit page, sent back as an `eq` filter. That
 * only works if the value round-trips to the microsecond — if it didn't, every
 * resubmit would read as "changed since you opened it". Against Postgres.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;

describe.skipIf(!KEY)("stories.updated_at as the edit form's version (Postgres)", () => {
  const db = createClient(URL_, KEY ?? "skipped", { auth: { persistSession: false } });
  const tag = `ver-${Date.now()}`;
  let id = "";

  afterAll(async () => {
    if (id) await db.from("stories").delete().eq("id", id);
  });

  it("matches the row it was read from, and stops matching once the row is written", async () => {
    // now() is microsecond precision — the case a millisecond Date would lose
    const { data: created, error } = await db.from("stories")
      .insert({ title: tag, slug: tag, status: "awaiting_approval", source: "member" }).select("id, updated_at").single();
    if (error) throw error;
    id = created.id;

    const first = await db.from("stories").update({ title: `${tag} a`, updated_at: new Date().toISOString() })
      .eq("id", id).eq("updated_at", created.updated_at).select("id");
    expect(first.data).toHaveLength(1);

    // the same stale version again: the row has moved on
    const second = await db.from("stories").update({ title: `${tag} b` }).eq("id", id).eq("updated_at", created.updated_at).select("id");
    expect(second.data).toEqual([]);
  });
});
