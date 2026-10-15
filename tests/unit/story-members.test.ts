import { describe, expect, it, vi } from "vitest";
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
  it("replaces the story's rows with exactly the given set", async () => {
    const builder = queryBuilder(dbOk(null));
    const db = asDb(mockDb({ from: fromByTable({ story_members: () => builder }) }));
    await replaceStoryMembers(db, "s1", [A, B, A]);
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("story_id", "s1");
    expect(builder.insert).toHaveBeenCalledWith([{ story_id: "s1", member_id: A }, { story_id: "s1", member_id: B }]);
  });

  it("an empty set just clears", async () => {
    const builder = queryBuilder(dbOk(null));
    const db = asDb(mockDb({ from: fromByTable({ story_members: () => builder }) }));
    await replaceStoryMembers(db, "s1", []);
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it("throws rather than half-saving when the clear fails", async () => {
    const db = asDb(mockDb({ from: fromByTable({ story_members: () => queryBuilder(dbError("boom")) }) }));
    await expect(replaceStoryMembers(db, "s1", [A])).rejects.toBeTruthy();
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
