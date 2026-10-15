import { describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/auth";
import { canPreviewStory, ownerMayPreview, previewBackHref, type PreviewableStory } from "@/lib/story-preview";

// /preview/story/[id] reads with the service role, so this function is the
// whole permission check (Jas 13/10 items 10/15). Exhaustive on purpose.
const admin: CurrentUser = { userId: "a", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas" };
const owner: CurrentUser = { userId: "u1", email: "m@acme.example", role: "member", memberId: "mem1", displayName: "Acme" };
const other: CurrentUser = { ...owner, userId: "u2", memberId: "mem2" };

const story = (over: Partial<PreviewableStory> = {}): PreviewableStory => ({
  status: "awaiting_approval", member_id: "mem1", source: "member", member_draft: false, ...over,
});

describe("canPreviewStory", () => {
  it("nobody anonymous, ever", () => {
    expect(canPreviewStory(null, story())).toBe(false);
  });

  it.each(["draft", "awaiting_approval", "scheduled", "rejected", "withdrawn"])("an admin can preview a %s story", (status) => {
    expect(canPreviewStory(admin, story({ status, source: "admin", member_id: null }))).toBe(true);
  });

  it("but not a member's private draft — it isn't the desk's until submitted", () => {
    expect(canPreviewStory(admin, story({ status: "draft", member_draft: true }))).toBe(false);
  });

  it.each([
    ["their own draft", story({ status: "draft", member_draft: true }), true],
    ["waiting on approval", story(), true],
    ["sent back", story({ status: "rejected" }), true],
    ["withdrawn", story({ status: "withdrawn" }), true],
    ["scheduled (the desk's now)", story({ status: "scheduled" }), false],
    ["an admin's draft naming them", story({ status: "draft", source: "admin" }), false],
    ["an admin's story awaiting approval naming them", story({ source: "admin" }), false],
  ])("the owning member: %s → %s", (_label, s, expected) => {
    expect(canPreviewStory(owner, s)).toBe(expected);
  });

  it("another member, never — even for a draft", () => {
    expect(canPreviewStory(other, story())).toBe(false);
    expect(canPreviewStory(other, story({ status: "draft", member_draft: true }))).toBe(false);
  });

  it("a member account with no member id gets nothing", () => {
    expect(canPreviewStory({ ...owner, memberId: null }, story({ member_id: null }))).toBe(false);
  });

  it("ownerMayPreview is the owner half of the same rule", () => {
    expect(ownerMayPreview(story({ status: "draft", member_draft: true }))).toBe(true);
    expect(ownerMayPreview(story({ status: "published" }))).toBe(false);
  });
});

describe("previewBackHref", () => {
  it("sends an admin to the console editor and a member to theirs", () => {
    expect(previewBackHref(admin, "s1")).toBe("/console/stories/s1");
    expect(previewBackHref(owner, "s1")).toBe("/dashboard/story/s1/edit");
  });
});
