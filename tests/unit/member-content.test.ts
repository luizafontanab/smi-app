import { describe, expect, it } from "vitest";
import {
  MEMBER_CHANGED_ERROR, memberCanDeleteStory, memberCanEdit, memberCanWithdraw, memberStoryImagePaths, STORY_CHANGED_ERROR,
} from "@/lib/member-content";
import { isMemberDraft } from "@/lib/story-board";

const memberCanEditStory = (row: Parameters<typeof memberCanEdit>[1], m: string) => memberCanEdit("story", row, m);
const memberCanWithdrawStory = (row: Parameters<typeof memberCanEdit>[1], m: string) => memberCanWithdraw("story", row, m);

// Jas 13/10: the member-draft rules, in one table. Luiza 16 Oct: the desk's
// work stays the desk's — a story is the member's to change only if they wrote it.
describe("story: memberCanEdit / memberCanWithdraw / memberCanDeleteStory", () => {
  const row = (over: Partial<{ member_id: string | null; status: string; member_draft: boolean; source: string }>) => ({
    member_id: "mem1", status: "awaiting_approval", member_draft: false, source: "member", ...over,
  });

  it.each([
    ["their own draft", row({ status: "draft", member_draft: true }), true, false, true],
    ["awaiting approval", row({}), true, true, false],
    ["sent back", row({ status: "rejected" }), true, true, false],
    ["live", row({ status: "published" }), false, false, false],
    ["scheduled", row({ status: "scheduled" }), false, false, false],
    ["withdrawn", row({ status: "withdrawn" }), false, false, false],
    ["an admin's draft naming them", row({ status: "draft", member_draft: false, source: "admin" }), false, false, false],
    ["an admin's \"Return to draft\" of their story", row({ status: "draft", member_draft: false }), false, false, false],
    ["the desk's story about them, awaiting approval", row({ source: "admin" }), false, false, false],
    ["the desk's story about them, sent back", row({ status: "rejected", source: "admin" }), false, false, false],
    ["an imported story about them", row({ source: "import" }), false, false, false],
    ["someone else's draft", row({ status: "draft", member_draft: true, member_id: "other" }), false, false, false],
    ["someone else's submission", row({ member_id: "other" }), false, false, false],
  ])("%s → edit %s, withdraw %s, delete %s", (_label, story, edit, withdraw, del) => {
    expect(memberCanEditStory(story, "mem1")).toBe(edit);
    expect(memberCanWithdrawStory(story, "mem1")).toBe(withdraw);
    expect(memberCanDeleteStory(story, "mem1")).toBe(del);
  });

  it("nothing for a missing row", () => {
    expect(memberCanEditStory(null, "mem1")).toBe(false);
    expect(memberCanWithdrawStory(null, "mem1")).toBe(false);
    expect(memberCanDeleteStory(undefined, "mem1")).toBe(false);
  });

  it("nothing for a row read without its source — the rule can't be answered, so the answer is no", () => {
    expect(memberCanEditStory({ member_id: "mem1", status: "awaiting_approval" }, "mem1")).toBe(false);
  });

  it("isMemberDraft reads the explicit flag, not status + source", () => {
    expect(isMemberDraft({ member_draft: true })).toBe(true);
    expect(isMemberDraft({ member_draft: false })).toBe(false);
    expect(isMemberDraft({})).toBe(false);
  });
});

// Submission intake D5: one rule for every kind. Videos and events now draw the
// same "the member wrote it" line stories do (Luiza, 3 Nov); they have no drafts.
describe.each(["video", "event"] as const)("%s: memberCanEdit / memberCanWithdraw", (kind) => {
  const row = (over: Partial<{ member_id: string | null; status: string; source: string }>) => ({
    member_id: "mem1", status: "awaiting_approval", source: "member", ...over,
  });

  it.each([
    ["awaiting approval", row({}), true],
    ["sent back", row({ status: "rejected" }), true],
    ["live", row({ status: "published" }), false],
    ["scheduled", row({ status: "scheduled" }), false],
    ["withdrawn", row({ status: "withdrawn" }), false],
    ["a draft", row({ status: "draft" }), false],
    ["the desk's, naming them, awaiting approval", row({ source: "manual" }), false],
    ["the desk's, naming them, sent back", row({ status: "rejected", source: "admin" }), false],
    ["someone else's", row({ member_id: "other" }), false],
  ])("%s → %s", (_label, r, allowed) => {
    expect(memberCanEdit(kind, r, "mem1")).toBe(allowed);
    expect(memberCanWithdraw(kind, r, "mem1")).toBe(allowed);
  });

  it("nothing for a missing row, or one read without its source", () => {
    expect(memberCanEdit(kind, null, "mem1")).toBe(false);
    expect(memberCanWithdraw(kind, { member_id: "mem1", status: "awaiting_approval" }, "mem1")).toBe(false);
  });
});

// Equipment is out of submission intake (D1) and keeps today's owner + status
// check — but through the same status list, not its own copy.
describe("machine: memberCanEdit / memberCanWithdraw", () => {
  it.each([
    ["awaiting approval", { member_id: "mem1", status: "awaiting_approval" }, true],
    ["sent back", { member_id: "mem1", status: "rejected" }, true],
    ["live", { member_id: "mem1", status: "published" }, false],
    ["someone else's", { member_id: "other", status: "rejected" }, false],
  ])("%s → %s", (_label, r, allowed) => {
    expect(memberCanEdit("machine", r, "mem1")).toBe(allowed);
    expect(memberCanWithdraw("machine", r, "mem1")).toBe(allowed);
  });
});

describe("MEMBER_CHANGED_ERROR", () => {
  it("names the kind, and the story wording is unchanged", () => {
    expect(MEMBER_CHANGED_ERROR.video).toMatch(/^This video changed after you opened it/);
    expect(MEMBER_CHANGED_ERROR.event).toMatch(/^This event changed after you opened it/);
    expect(STORY_CHANGED_ERROR).toBe(
      "This story changed after you opened it — the SMI editor may have approved, edited or sent it back. Nothing was saved; here is where it stands now.",
    );
  });
});

// Review finding 16 Oct: deleting a draft orphaned the photos in its body.
describe("memberStoryImagePaths", () => {
  const url = (path: string) => `https://abc.supabase.co/storage/v1/object/public/media/${path}`;

  it("finds the member's own body uploads, deduplicated", () => {
    const body = `<p><img src="${url("stories/mem1/k1x.jpg")}"></p><figure><img src="${url("stories/mem1/k2y.webp")}"></figure><img src="${url("stories/mem1/k1x.jpg")}">`;
    expect(memberStoryImagePaths(body, "mem1")).toEqual(["stories/mem1/k1x.jpg", "stories/mem1/k2y.webp"]);
  });

  it("never offers another member's image, a desk upload, an external image or a lookalike path", () => {
    const body = [
      url("stories/mem2/a1.jpg"),
      url("stories/b2.jpg"),
      "https://example.com/storage/v1/object/public/media/stories/mem10/a.jpg",
      url("stories/mem1/../members/x.png"),
      url("stories/mem1/a1.jpg.html"),
      url("stories/mem1/nested/a1.jpg"),
    ].map((src) => `<img src="${src}">`).join("");
    expect(memberStoryImagePaths(body, "mem1")).toEqual([]);
  });

  it("is empty for an empty body or a missing member", () => {
    expect(memberStoryImagePaths("", "mem1")).toEqual([]);
    expect(memberStoryImagePaths(null, "mem1")).toEqual([]);
    expect(memberStoryImagePaths(`<img src="${url("stories/mem1/a.jpg")}">`, "")).toEqual([]);
  });
});
