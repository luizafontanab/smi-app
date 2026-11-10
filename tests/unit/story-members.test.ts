import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { enqueueStoryLive, replaceStoryMembers, resolveStoryMembers, taggedMembers } from "@/lib/story-members";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";

// Jas 13/10 item 12: several members per story. story_members holds every one,
// the primary included; stories.member_id is the primary.
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

describe("resolveStoryMembers", () => {
  it("primary first, extras deduped, the primary never repeated", () => {
    expect(resolveStoryMembers(A, [B, A, B, C])).toEqual({ ids: [A, B, C] });
  });

  it("drops anything that isn't a member id", () => {
    expect(resolveStoryMembers(A, ["", "nope", B])).toEqual({ ids: [A, B] });
  });

  it("no primary and no extras: nobody tagged", () => {
    expect(resolveStoryMembers(null, [])).toEqual({ ids: [] });
  });

  it("refuses extras without a primary — the primary owns the story and leads its tiles", () => {
    expect(resolveStoryMembers(null, [B])).toEqual({ error: expect.stringContaining("subject member") });
  });
});

describe("replaceStoryMembers", () => {
  // One rpc, one transaction (migration 20261016000010) — never a separate
  // delete and insert, which left a story with nobody tagged when the insert
  // failed. The atomicity itself is proved against Postgres below.
  it("replaces the set in one call to replace_story_members, deduped, without touching the table directly", async () => {
    const from = fromByTable({});
    const raw = mockDb({ from });
    await replaceStoryMembers(asDb(raw), "s1", [A, B, A]);
    expect(raw.rpc).toHaveBeenCalledWith("replace_story_members", { p_story_id: "s1", p_member_ids: [A, B] });
    expect(from).not.toHaveBeenCalled();
  });

  it("an empty set still calls through, so the story is cleared", async () => {
    const raw = mockDb({ from: fromByTable({}) });
    await replaceStoryMembers(asDb(raw), "s1", []);
    expect(raw.rpc).toHaveBeenCalledWith("replace_story_members", { p_story_id: "s1", p_member_ids: [] });
  });

  it("throws the database error, so the caller can say the tags weren't saved", async () => {
    const raw = mockDb({ from: fromByTable({}), rpc: async () => dbError("insert or update violates foreign key") });
    await expect(replaceStoryMembers(asDb(raw), "s1", [A])).rejects.toMatchObject({ message: "insert or update violates foreign key" });
  });
});

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;

// The guarantee the unit tests above can't show: a failed insert rolls the
// delete back. Against the local stack.
describe.skipIf(!KEY)("replace_story_members (Postgres)", () => {
  const real = createClient<Database>(URL_, KEY ?? "skipped", { auth: { persistSession: false } });
  const tag = Date.now().toString(36);
  let storyId = "";
  let memberId = "";

  beforeAll(async () => {
    const { data: m } = await real.from("members").insert({ slug: `tags-test-${tag}`, name: "Tags Test Ltd", status: "draft" }).select("id").single();
    memberId = m!.id;
    const { data: s } = await real.from("stories").insert({ slug: `tags-test-${tag}`, title: "Tags test", status: "draft", source: "admin", member_id: memberId }).select("id").single();
    storyId = s!.id;
  });

  afterAll(async () => {
    if (storyId) await real.from("stories").delete().eq("id", storyId);
    if (memberId) await real.from("members").delete().eq("id", memberId);
  });

  const tagged = async () => (await real.from("story_members").select("member_id").eq("story_id", storyId)).data?.map((r) => r.member_id);

  it("replaces the set", async () => {
    await replaceStoryMembers(real, storyId, [memberId]);
    expect(await tagged()).toEqual([memberId]);
  });

  it("a failed insert (a member that doesn't exist) leaves the previous set in place", async () => {
    await replaceStoryMembers(real, storyId, [memberId]);
    await expect(replaceStoryMembers(real, storyId, [memberId, "99999999-9999-9999-9999-999999999999"])).rejects.toBeTruthy();
    expect(await tagged()).toEqual([memberId]);
  });

  it("anon can't call it — a member must never retag a story through /rest/v1/rpc", async () => {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!anonKey) return;
    const anon = createClient<Database>(URL_, anonKey, { auth: { persistSession: false } });
    const { error } = await anon.rpc("replace_story_members", { p_story_id: storyId, p_member_ids: [] });
    expect(error?.code).toBe("42501");
    expect(await tagged()).toEqual([memberId]);
  });
});

const member = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  member: { id, slug: name.toLowerCase(), name, logo_path: null, social: {}, status: "active", archived_at: null, ...extra },
});

describe("taggedMembers", () => {
  it("primary first, then by name", async () => {
    const db = asDb(mockDb({ from: fromByTable({ story_members: () => queryBuilder(dbOk([member(C, "Zeta"), member(B, "Alpha"), member(A, "Mid")])) }) }));
    expect((await taggedMembers(db, "s1", A)).map((m) => m.name)).toEqual(["Mid", "Alpha", "Zeta"]);
  });
});

describe("enqueueStoryLive", () => {
  it("story_live for the primary, story_featured for each public co-featured member", async () => {
    const db = asDb(mockDb({
      from: fromByTable({
        story_members: () => queryBuilder(dbOk([
          member(A, "Primary"),
          member(B, "Grace", { status: "grace" }),
          member(C, "Archived", { archived_at: "2026-10-01" }),
        ])),
      }),
    }));
    const enqueue = vi.fn(async () => {});
    await enqueueStoryLive(db, { id: "s1", member_id: A }, enqueue);
    expect(enqueue.mock.calls).toEqual([
      ["notify_member", { member_id: A, kind: "story_live", story_id: "s1" }],
      ["notify_member", { member_id: B, kind: "story_featured", story_id: "s1" }],
    ]);
  });

  it("a story with no members tells nobody", async () => {
    const db = asDb(mockDb({ from: fromByTable({ story_members: () => queryBuilder(dbOk([])) }) }));
    const enqueue = vi.fn(async () => {});
    await enqueueStoryLive(db, { id: "s1", member_id: null }, enqueue);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
