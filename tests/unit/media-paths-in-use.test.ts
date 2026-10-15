import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * media_paths_in_use (migration 20261016000021) decides which of a deleted
 * draft's images may be removed — a wrong "unused" is a broken image on
 * someone's page. Runs against the local Supabase stack.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const KEY = process.env.SUPABASE_SECRET_KEY;

describe.skipIf(!KEY)("media_paths_in_use (Postgres)", () => {
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
  const tag = `mpiu${Date.now().toString(36)}`;
  const storyIds: string[] = [];
  const pageSlug = `${tag}-page`;

  afterAll(async () => {
    if (storyIds.length) await db.from("stories").delete().in("id", storyIds);
    await db.from("static_pages").delete().eq("slug", pageSlug);
  });

  const inUse = async (paths: string[]) => {
    const { data, error } = await db.rpc("media_paths_in_use", { p_paths: paths });
    if (error) throw error;
    return [...(data as string[])].sort();
  };

  it("finds a path in a story body (as its full public URL), as a cover, and on a static page — and nothing else", async () => {
    const inBody = `stories/${tag}/body1.jpg`;
    const asCover = `stories/${tag}xcover.jpg`;
    const onPage = `stories/${tag}/page1.png`;
    const unused = `stories/${tag}/gone.webp`;
    const { data, error } = await db.from("stories").insert({
      title: tag, slug: tag, status: "draft", source: "admin",
      body: `<p><img src="https://x.supabase.co/storage/v1/object/public/media/${inBody}"></p>`, cover_path: asCover,
    }).select("id").single();
    if (error) throw error;
    storyIds.push(data.id);
    const { error: pageError } = await db.from("static_pages").insert({ slug: pageSlug, title: tag, body: `<img src="/media/${onPage}">` });
    if (pageError) throw pageError;

    expect(await inUse([inBody, asCover, onPage, unused])).toEqual([asCover, inBody, onPage].sort());
    expect(await inUse([unused])).toEqual([]);
  });

  // Runs after the test above, whose rows are still there: under LIKE, both
  // of these would match them.
  it("matches literally — a LIKE wildcard in a path is just a character", async () => {
    expect(await inUse([`stories/${tag}/%`, `stories/${tag}_cover.jpg`, ""])).toEqual([]);
  });

  it("is service-role only", async () => {
    if (!ANON_KEY) return;
    const anon = createClient(URL_, ANON_KEY, { auth: { persistSession: false } });
    const { error } = await anon.rpc("media_paths_in_use", { p_paths: ["x"] });
    expect(error?.code).toBe("42501");
  });
});
