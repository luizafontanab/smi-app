import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { memberStoryViewCount, memberStoryViewMonths } from "@/lib/member-story-reach";
import { asDb, dbError, dbOk, fromByTable, mockDb } from "../stubs/supabase";

// Review finding 16 Oct: the stats page's "all time" story views counted only
// stories published *now* — unpublishing one took its views away — and sent
// every story id in the request URL.
describe("memberStoryViewCount / memberStoryViewMonths", () => {
  it("count in the database, by member — no story id list, no table reads", async () => {
    const from = fromByTable({});
    const raw = mockDb({ from, rpc: async () => dbOk(42) });
    expect(await memberStoryViewCount(asDb(raw), "mem1")).toBe(42);
    expect(raw.rpc).toHaveBeenCalledWith("member_story_view_count", { p_member: "mem1" });
    await memberStoryViewCount(asDb(raw), "mem1", "2026-09-16T00:00:00.000Z");
    expect(raw.rpc).toHaveBeenCalledWith("member_story_view_count", { p_member: "mem1", p_since: "2026-09-16T00:00:00.000Z" });
    expect(from).not.toHaveBeenCalled();
  });

  it("shape the months for the page's month buckets", async () => {
    const raw = mockDb({ from: fromByTable({}), rpc: async () => dbOk([{ month: "2026-09", n: 5 }, { month: "2026-10", n: 2 }]) });
    expect(await memberStoryViewMonths(asDb(raw), "mem1", "2025-10-16")).toEqual([
      { day: "2026-09-01", count: 5 },
      { day: "2026-10-01", count: 2 },
    ]);
    expect(raw.rpc).toHaveBeenCalledWith("member_story_view_months", { p_member: "mem1", p_since: "2025-10-16" });
  });

  it("read a failure as zero, like every other figure on the page", async () => {
    const raw = mockDb({ from: fromByTable({}), rpc: async () => dbError("boom") });
    expect(await memberStoryViewCount(asDb(raw), "mem1")).toBe(0);
    expect(await memberStoryViewMonths(asDb(raw), "mem1", "2025-10-16")).toEqual([]);
  });
});

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;

// The rule itself, against Postgres (migration 20261016000022).
describe.skipIf(!KEY)("member_story_view_count (Postgres)", () => {
  const db = createClient(URL_, KEY!, { auth: { persistSession: false } });
  const tag = `reach-${Date.now()}`;
  const ids: { members: string[]; stories: string[] } = { members: [], stories: [] };

  afterEach(async () => {
    await db.from("analytics_events").delete().eq("path", `/itest/${tag}`);
    if (ids.stories.length) await db.from("stories").delete().in("id", ids.stories);
    if (ids.members.length) await db.from("members").delete().in("id", ids.members);
    ids.members = [];
    ids.stories = [];
  });

  async function member(name: string) {
    const { data, error } = await db.from("members").insert({ name: `${tag} ${name}`, slug: `${tag}-${name}`, status: "active" }).select("id").single();
    if (error) throw error;
    ids.members.push(data.id);
    return data.id as string;
  }
  async function storyFor(primary: string, status = "published") {
    const { data, error } = await db.from("stories")
      .insert({ title: `${tag} story`, slug: `${tag}-${ids.stories.length}`, status, source: "admin", member_id: primary }).select("id").single();
    if (error) throw error;
    ids.stories.push(data.id);
    return data.id as string;
  }
  async function views(storyId: string, primaryAtViewTime: string, count: number) {
    const rows = Array.from({ length: count }, () => ({ kind: "story_view", story_id: storyId, member_id: primaryAtViewTime, path: `/itest/${tag}` }));
    const { error } = await db.from("analytics_events").insert(rows);
    if (error) throw error;
  }
  const count = async (memberId: string) => {
    const { data, error } = await db.rpc("member_story_view_count", { p_member: memberId });
    if (error) throw error;
    return Number(data);
  };

  it("doesn't drop when the story is unpublished, or when its primary changes", async () => {
    const a = await member("a");
    const b = await member("b");
    const s = await storyFor(a);
    await db.rpc("replace_story_members", { p_story_id: s, p_member_ids: [a] });
    await views(s, a, 3);
    expect(await count(a)).toBe(3);

    await db.from("stories").update({ status: "draft" }).eq("id", s);
    expect(await count(a)).toBe(3);

    // the desk hands the story to B: A was primary when it was read, so keeps the views
    await db.from("stories").update({ member_id: b }).eq("id", s);
    await db.rpc("replace_story_members", { p_story_id: s, p_member_ids: [b] });
    expect(await count(a)).toBe(3);
    expect(await count(b)).toBe(3);
  });

  it("credits a co-featured member, counting each view once", async () => {
    const a = await member("a");
    const c = await member("c");
    const s = await storyFor(a);
    await db.rpc("replace_story_members", { p_story_id: s, p_member_ids: [a, c] });
    await views(s, a, 2);
    expect(await count(c)).toBe(2);
    expect(await count(a)).toBe(2); // primary AND tagged: still two views, not four
  });

  it("is service-role only", async () => {
    const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!ANON) return;
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { error } = await anon.rpc("member_story_view_count", { p_member: "00000000-0000-0000-0000-000000000000" });
    expect(error?.code).toBe("42501");
  });
});
