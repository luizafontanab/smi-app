import { describe, expect, it } from "vitest";
import { memberCanDeleteStory, memberCanEditStory } from "@/lib/member-story";
import { isMemberDraft } from "@/lib/story-board";

// Jas 13/10: the member-draft rules, in one table.
describe("memberCanEditStory / memberCanDeleteStory", () => {
  const row = (over: Partial<{ member_id: string | null; status: string; member_draft: boolean }>) => ({
    member_id: "mem1", status: "awaiting_approval", member_draft: false, ...over,
  });

  it.each([
    ["their own draft", row({ status: "draft", member_draft: true }), true, true],
    ["awaiting approval", row({}), true, false],
    ["sent back", row({ status: "rejected" }), true, false],
    ["live", row({ status: "published" }), false, false],
    ["scheduled", row({ status: "scheduled" }), false, false],
    ["withdrawn", row({ status: "withdrawn" }), false, false],
    ["an admin's draft naming them", row({ status: "draft", member_draft: false }), false, false],
    ["someone else's draft", row({ status: "draft", member_draft: true, member_id: "other" }), false, false],
  ])("%s → edit %s, delete %s", (_label, story, edit, del) => {
    expect(memberCanEditStory(story, "mem1")).toBe(edit);
    expect(memberCanDeleteStory(story, "mem1")).toBe(del);
  });

  it("nothing for a missing row", () => {
    expect(memberCanEditStory(null, "mem1")).toBe(false);
    expect(memberCanDeleteStory(undefined, "mem1")).toBe(false);
  });

  it("isMemberDraft reads the explicit flag, not status + source", () => {
    expect(isMemberDraft({ member_draft: true })).toBe(true);
    expect(isMemberDraft({ member_draft: false })).toBe(false);
    expect(isMemberDraft({})).toBe(false);
  });
});
