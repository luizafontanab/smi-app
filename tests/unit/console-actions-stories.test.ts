import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consoleUploadImage, decideStory, moveStory, pinStory, saveSocialCaps, saveStory, scheduleStory, setStoryStatus,
  saveSiteVariant, clearMyVariantOverride, saveHomeSections, setErrorStatus, saveFeatureFlag,
} from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, sequence } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { UPLOAD_EXPIRED } from "@/lib/upload-limits";
import { revalidatePath } from "next/cache";
import type { CurrentUser } from "@/lib/auth";
import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, uploadImage, removeMedia, enqueue } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  removeMedia: vi.fn<(path: string | null | undefined) => Promise<void>>(async () => {}),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia }));
vi.mock("@/lib/jobs", () => ({ enqueue }));

afterEach(() => {
  resetDbServerMocks();
  vi.mocked(revalidatePath).mockClear();
  uploadImage.mockReset().mockResolvedValue(null);
  removeMedia.mockReset().mockResolvedValue(undefined);
  enqueue.mockReset().mockResolvedValue(undefined);
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>, rpc?: (...args: unknown[]) => unknown) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  const raw = mockDb({ from, rpc });
  vi.mocked(serviceDb).mockReturnValue(asDb(raw));
  return Object.assign(from, { rpc: raw.rpc });
}

describe("consoleUploadImage", () => {
  it("uploads under stories/console and returns a public URL", async () => {
    uploadImage.mockResolvedValue("stories/console/a.jpg");
    expect(await consoleUploadImage(form({}))).toEqual({ url: expect.stringContaining("stories/console/a.jpg") });
    expect(uploadImage).toHaveBeenCalledWith(null, "stories/console");
  });

  it("returns the refusal reason as a value instead of throwing", async () => {
    uploadImage.mockRejectedValue(new Error("Images only — JPEG, PNG, WebP, GIF or AVIF."));
    expect(await consoleUploadImage(form({}))).toEqual({ error: "Images only — JPEG, PNG, WebP, GIF or AVIF." });
  });

  it("still lets the auth guard's redirect through", async () => {
    requireConsole.mockRejectedValueOnce(new Error("NEXT_REDIRECT;/login"));
    await expect(consoleUploadImage(form({}))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  // Direct uploads (lib/staged-upload): the editor posts a staged path. The
  // console claims only from its own staging prefix — not a member's.
  it("claims a file staged under the console prefix, and refuses one staged by a member", async () => {
    const NAME = "3d6f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b.png";
    const bucket = {
      info: vi.fn(async () => dbOk({ size: 3, contentType: "image/png", metadata: { name: "x.png" } })),
      download: vi.fn(async () => dbOk(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }))),
      remove: vi.fn(async () => dbOk([])),
    };
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ storage: { from: vi.fn(() => bucket) } })));
    uploadImage.mockResolvedValue("stories/console/a.png");

    expect(await consoleUploadImage(form({ file: `members/m1/${NAME}` }))).toEqual({ error: UPLOAD_EXPIRED });
    expect(bucket.info).not.toHaveBeenCalled();

    expect(await consoleUploadImage(form({ file: `console/${NAME}` }))).toEqual({ url: expect.stringContaining("stories/console/a.png") });
    expect(uploadImage.mock.calls[0][0]).toBeInstanceOf(File);
  });
});

// Jas 13/10 item 12.
describe("saveStory — tagging several members", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";

  it("writes the subject member and every tagged member to story_members, primary first", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", cover_path: null, member_draft: false }));
    const from = db({ stories: () => storiesBuilder });
    const f = form({ id: "s1", title: "Southern Manufacturing", member_id: A });
    f.append("tagged_member_ids", B);
    f.append("tagged_member_ids", A);

    await expect(saveStory(f)).rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?saved=1");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ member_id: A }));
    // one transaction (replace_story_members), never a bare delete + insert
    expect(from.rpc).toHaveBeenCalledWith("replace_story_members", { p_story_id: "s1", p_member_ids: [A, B] });
    expect(from).not.toHaveBeenCalledWith("story_members");
  });

  it("a failed retag says so on the editor instead of throwing to the error page", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", cover_path: null, member_draft: false }));
    db({ stories: () => storiesBuilder }, async () => dbError("insert or update on table \"story_members\" violates foreign key constraint"));
    await expect(saveStory(form({ id: "s1", title: "T", member_id: A })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/s1\?error=.*tagged%20members/);
  });

  it("refuses tagged members without a subject member, before writing anything", async () => {
    const from = db({});
    const f = form({ id: "s1", title: "T", member_id: "" });
    f.append("tagged_member_ids", B);
    await expect(saveStory(f)).rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/s1\?error=/);
    expect(from).not.toHaveBeenCalled();
  });
});

// Jas 13/10 item 8.
describe("saveStory — SMI's posts of the story", () => {
  it("stores the pasted post links, leaving blank networks out", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", cover_path: null, member_draft: false }));
    db({ stories: () => storiesBuilder });
    await expect(saveStory(form({ id: "s1", title: "T", post_linkedin: "https://www.linkedin.com/posts/a", post_x: "" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?saved=1");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      social_posts: { linkedin: "https://www.linkedin.com/posts/a" },
    }));
  });

  it("refuses a link that isn't that network's, before uploading anything", async () => {
    const from = db({});
    await expect(saveStory(form({ id: "s1", title: "T", post_facebook: "https://evil.example/fb" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/s1\?error=.*Facebook/);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("saveStory", () => {
  // Was "does nothing for a blank title" — it now says so instead of returning
  // silently (fix-list 73): a bare return left the editor looking unchanged,
  // which is the same invisibility the rest of that item fixes.
  it("redirects with a readable error for a blank title", async () => {
    const from = db({});
    await expect(saveStory(form({ title: " " }))).rejects.toThrow(/NEXT_REDIRECT.*error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("creates a new story as a draft attributed to the admin, links categories, and redirects to it", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1" }));
    const catLinkBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, story_categories: () => catLinkBuilder });

    await expect(saveStory(form({ title: "New Story", categories: "3" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/s1");

    expect(storiesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", source: "admin", submitted_by: "admin1" }));
    expect(catLinkBuilder.delete).toHaveBeenCalledWith(); // called with .eq below, delete itself takes no args
    expect(catLinkBuilder.insert).toHaveBeenCalledWith([{ story_id: "s1", category_id: 3 }]);
  });

  it("updates an existing story, and removes the old cover only when it's actually replaced", async () => {
    const storiesBuilder = queryBuilder(dbOk({ cover_path: "old.jpg" }));
    db({ stories: () => storiesBuilder });
    uploadImage.mockResolvedValue("new.jpg");

    await expect(saveStory(form({ id: "s1", title: "Updated" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/s1");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ title: "Updated", cover_path: "new.jpg" }));
    expect(removeMedia).toHaveBeenCalledWith("old.jpg");
  });

  it("redirects with the upload error and never touches the database", async () => {
    uploadImage.mockRejectedValue(new Error("Image too large (8MB max)"));
    const from = db({});

    await expect(saveStory(form({ title: "t" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/new?error=Image%20too%20large%20(8MB%20max)");
    expect(from).not.toHaveBeenCalled();
  });

  it("checks the story exists before uploading, so a stale id leaves no orphaned cover", async () => {
    db({ stories: () => queryBuilder(dbOk(null)) });
    uploadImage.mockResolvedValue("new.jpg");
    await expect(saveStory(form({ id: "gone", title: "T" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\?error=/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("removes the new cover when the update fails, and says so rather than ?saved=1", async () => {
    db({ stories: sequence(dbOk({ cover_path: "old.jpg", member_draft: false }), dbError("boom")) });
    uploadImage.mockResolvedValue("new.jpg");
    await expect(saveStory(form({ id: "s1", title: "T" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/s1\?error=/);
    expect(removeMedia).toHaveBeenCalledWith("new.jpg");
    expect(removeMedia).not.toHaveBeenCalledWith("old.jpg");
  });

  it("removes the new cover when creating the story fails", async () => {
    db({ stories: () => queryBuilder(dbError("boom")) });
    uploadImage.mockResolvedValue("new.jpg");
    await expect(saveStory(form({ title: "T" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\/new\?error=/);
    expect(removeMedia).toHaveBeenCalledWith("new.jpg");
  });

  it("writes the industry, and clears it when the select is left blank", async () => {
    // industry_id is what /industry/[slug] filters on. Before this field the
    // column could only be set by migration 20260909000002's backfill.
    const storiesBuilder = queryBuilder(dbOk({ id: "s1" }));
    db({ stories: () => storiesBuilder });

    await expect(saveStory(form({ id: "s1", title: "Tagged", industry_id: "4" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/s1");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ industry_id: 4 }));

    await expect(saveStory(form({ id: "s1", title: "Untagged", industry_id: "" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/s1");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ industry_id: null }));
  });
});

describe("scheduleStory", () => {
  it("publishes immediately and enqueues the social push + member notification", async () => {
    const storiesBuilder = queryBuilder(dbOk({ member_id: "m1" }));
    db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", mode: "now" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, expect.any(Date));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "story_live" }));
  });

  it("schedules for later without touching jobs directly", async () => {
    const storiesBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", scheduled_at: "2026-09-01T10:00" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("only honours a return_to that actually points back at the story board", async () => {
    db({ stories: () => queryBuilder(dbOk(null)) });

    await expect(scheduleStory(form({ id: "s1", return_to: "/console/stories?view=calendar" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories?view=calendar");

    await expect(scheduleStory(form({ id: "s1", return_to: "https://evil.example" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories");
  });

  it("scheduling for later from awaiting_approval also records the approval, without publishing yet", async () => {
    const storiesBuilder = queryBuilder(dbOk({ member_id: "m1", status: "awaiting_approval" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, approvals: () => approvalsBuilder });

    await expect(scheduleStory(form({ id: "s1", scheduled_at: "2026-09-01T10:00" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "story", decision: "approved", decided_by: "admin1" }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("publishing now from awaiting_approval also records the approval", async () => {
    const storiesBuilder = queryBuilder(dbOk({ member_id: "m1", status: "awaiting_approval" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, approvals: () => approvalsBuilder });

    await expect(scheduleStory(form({ id: "s1", mode: "now" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories");

    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "story", decision: "approved" }));
    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, expect.any(Date));
  });

  it("does not record an approval when scheduling from a status other than awaiting_approval", async () => {
    const storiesBuilder = queryBuilder(dbOk({ member_id: "m1", status: "draft" }));
    const from = db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", scheduled_at: "2026-09-01T10:00" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(from).not.toHaveBeenCalledWith("approvals");
  });
});

describe("decideStory", () => {
  it("is a no-op once the story has already been decided", async () => {
    const from = db({ stories: () => queryBuilder(dbOk({ id: "s1", status: "published" })) });
    await decideStory(form({ id: "s1", decision: "approve" }));
    expect(from).not.toHaveBeenCalledWith("approvals");
  });

  // Pinning is a separate, optional step once a story is live (15 Oct) —
  // approving must never set pinned_until, by either approval route.
  it("approving never pins the story", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: null, status: "awaiting_approval" }));
    db({ stories: () => storiesBuilder, approvals: () => queryBuilder(dbOk(null)) });
    await decideStory(form({ id: "s1", decision: "approve" }));
    await expect(scheduleStory(form({ id: "s1", mode: "now" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(storiesBuilder.update).toHaveBeenCalled();
    expect(storiesBuilder.update).not.toHaveBeenCalledWith(expect.objectContaining({ pinned_until: expect.anything() }));
  });

  it("approving publishes and enqueues social push + notify, and records the approval", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, approvals: () => approvalsBuilder });

    await decideStory(form({ id: "s1", decision: "approve" }));

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "story_live" }));
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "story", decision: "approved" }));
  });

  it("rejecting a member's story records the reason and notifies the member without publishing", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval", source: "member" }));
    db({ stories: () => storiesBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideStory(form({ id: "s1", decision: "reject", reason: "Needs a photo" }));

    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "rejected", rejected_reason: "Needs a photo" });
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "story_rejected", reason: "Needs a photo" }));
  });

  // Jas's flow chart (16 Oct): "not yet" goes back to draft. member_id on the
  // desk's own story is the company it's about — before 20 Oct they were
  // emailed a "your story was sent back" for a story they never wrote.
  it("'not yet' on the desk's own story puts it back to draft and emails nobody", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval", source: "admin" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, approvals: () => approvalsBuilder });

    await decideStory(form({ id: "s1", decision: "reject" }));

    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "draft" });
    expect(enqueue).not.toHaveBeenCalled();
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "story", decision: "rejected", reason: null }));
  });
});

describe("pinStory", () => {
  it("sets a future pinned_until for a positive day count, and clears it for zero", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ stories: () => builder });

    await pinStory(form({ id: "s1", days: "7" }));
    expect(builder.update).toHaveBeenCalledWith({ pinned_until: expect.any(String) });

    await pinStory(form({ id: "s1", days: "0" }));
    expect(builder.update).toHaveBeenCalledWith({ pinned_until: null });
  });
});

// Jas 13/10: a member's unsubmitted draft is theirs until they submit it — the
// desk can't publish, schedule, move or overwrite it, by any route.
describe("member drafts are out of the console's reach", () => {
  const memberDraft = { id: "s1", status: "draft", source: "member", member_draft: true, member_id: "m1", cover_path: null };

  it("moveStory treats one as not found, and never publishes it", async () => {
    const storiesBuilder = queryBuilder(dbOk(memberDraft));
    db({ stories: () => storiesBuilder });
    expect(await moveStory({ id: "s1", to: "published" })).toEqual({ ok: false, error: "Story not found." });
    expect(storiesBuilder.update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("scheduleStory's Publish now refuses one", async () => {
    const storiesBuilder = queryBuilder(dbOk(memberDraft));
    db({ stories: () => storiesBuilder });
    await expect(scheduleStory(form({ id: "s1", mode: "now" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories");
    expect(storiesBuilder.update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("saveStory refuses to overwrite one", async () => {
    const storiesBuilder = queryBuilder(dbOk(memberDraft));
    db({ stories: () => storiesBuilder });
    await expect(saveStory(form({ id: "s1", title: "Admin edit" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\?error=/);
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("an admin's own draft about a member still moves as before", async () => {
    const storiesBuilder = queryBuilder(dbOk({ ...memberDraft, source: "admin", member_draft: false }));
    db({ stories: () => storiesBuilder });
    expect(await moveStory({ id: "s1", to: "published" })).toEqual({ ok: true });
  });
});

describe("moveStory", () => {
  it("reports a not-found story rather than throwing", async () => {
    db({ stories: () => queryBuilder(dbOk(null)) });
    expect(await moveStory({ id: "missing", to: "published" })).toEqual({ ok: false, error: "Story not found." });
  });

  it("refuses an illegal transition without touching the row", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "published", member_id: null }));
    db({ stories: () => storiesBuilder });

    const result = await moveStory({ id: "s1", to: "awaiting_approval" });

    expect(result.ok).toBe(false);
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("publishing from awaiting_approval also records the approval, mirroring decideStory", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "awaiting_approval", member_id: "m1" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, approvals: () => approvalsBuilder });

    const result = await moveStory({ id: "s1", to: "published" });

    expect(result).toEqual({ ok: true });
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ decision: "approved" }));
  });

  it("moving between two non-published statuses just updates the status, no approval row", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "draft", member_id: null }));
    const from = db({ stories: () => storiesBuilder });

    const result = await moveStory({ id: "s1", to: "awaiting_approval" });

    expect(result).toEqual({ ok: true });
    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "awaiting_approval" });
    expect(from).not.toHaveBeenCalledWith("approvals");
  });
});

describe("moveStory — review back to draft", () => {
  it("won't drag a member's submission back to draft — that's Send back, with a reason", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "awaiting_approval", member_id: "m1", member_draft: false, source: "member" }));
    db({ stories: () => storiesBuilder });

    expect(await moveStory({ id: "s1", to: "draft" })).toEqual({ ok: false, error: expect.stringContaining("sent back from its editor") });
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("drags the desk's own story back to draft, recording the 'not yet' like decideStory", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "awaiting_approval", member_id: "m1", member_draft: false, source: "admin" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, approvals: () => approvalsBuilder });

    expect(await moveStory({ id: "s1", to: "draft" })).toEqual({ ok: true });
    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "draft" });
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "story", decision: "rejected" }));
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("moveStory — a failed write is reported, not swallowed", () => {
  it("publishing: no social push or member emails for a story that didn't publish", async () => {
    db({ stories: sequence(dbOk({ id: "s1", status: "draft", member_id: "m1", member_draft: false }), dbError("boom")) });
    expect(await moveStory({ id: "s1", to: "published" })).toEqual({ ok: false, error: expect.stringContaining("couldn't be published") });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("any other move", async () => {
    db({ stories: sequence(dbOk({ id: "s1", status: "draft", member_id: null, member_draft: false }), dbError("boom")) });
    expect(await moveStory({ id: "s1", to: "awaiting_approval" })).toEqual({ ok: false, error: expect.stringContaining("couldn't be moved") });
  });
});

describe("setStoryStatus", () => {
  it("a refused move comes back as ?error=, not as if the card moved", async () => {
    db({ stories: () => queryBuilder(dbOk({ id: "s1", status: "published", member_id: null, member_draft: false })) });
    await expect(setStoryStatus(form({ id: "s1", status: "awaiting_approval" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/stories\?error=Can't%20move%20a%20published%20story/);
  });

  it("does nothing without both an id and a status", async () => {
    await expect(setStoryStatus(form({ id: "s1" }))).resolves.toBeUndefined();
  });

  it("moves the card and redirects back to the board", async () => {
    db({ stories: () => queryBuilder(dbOk({ id: "s1", status: "draft", member_id: null })) });

    await expect(setStoryStatus(form({ id: "s1", status: "awaiting_approval" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories");
  });

  // The editor's "Mark ready to review" (20 Oct) comes back to the editor.
  it("returns to the story's own editor when asked, and to the board for any other return_to", async () => {
    db({ stories: () => queryBuilder(dbOk({ id: "s1", status: "draft", member_id: null })) });
    await expect(setStoryStatus(form({ id: "s1", status: "awaiting_approval", return_to: "/console/stories/s1" })))
      .rejects.toThrow(/^NEXT_REDIRECT:\/console\/stories\/s1$/);
    await expect(setStoryStatus(form({ id: "s1", status: "awaiting_approval", return_to: "/console/stories/other" })))
      .rejects.toThrow(/^NEXT_REDIRECT:\/console\/stories$/);
  });
});

describe("saveSocialCaps", () => {
  it("floors per_day at 1 and delay_minutes at 0, and upserts by key", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await saveSocialCaps(form({ per_day: "0", delay_minutes: "-10" }));

    expect(builder.upsert).toHaveBeenCalledWith({ key: "social_caps", value: { per_day: 1, delay_minutes: 0 } });
  });

  it("saves a valid value as-is", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await saveSocialCaps(form({ per_day: "5", delay_minutes: "45" }));

    expect(builder.upsert).toHaveBeenCalledWith({ key: "social_caps", value: { per_day: 5, delay_minutes: 45 } });
  });
});

// docs/logging.md: resolving an error is developer-only, like the page.
describe("setErrorStatus", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  afterEach(() => vi.unstubAllEnvs());

  it("404s an admin who isn't on DEVELOPER_EMAILS, without writing", async () => {
    vi.stubEnv("DEVELOPER_EMAILS", "someone-else@example.com");
    const from = db({});
    await expect(setErrorStatus(form({ id: ID, status: "resolved" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(from).not.toHaveBeenCalled();
  });

  it("lets a developer resolve an error, stamping resolved_at", async () => {
    const me = await requireConsole();
    vi.stubEnv("DEVELOPER_EMAILS", me.email);
    const builder = queryBuilder(dbOk(null));
    db({ error_events: () => builder });

    await expect(setErrorStatus(form({ id: ID, status: "resolved" }))).rejects.toThrow(`NEXT_REDIRECT:/console/errors/${ID}?saved=1`);

    expect(builder.update).toHaveBeenCalledWith({ status: "resolved", resolved_at: expect.any(String) });
    expect(builder.eq).toHaveBeenCalledWith("id", ID);
  });

  it("ignores an unknown status or a malformed id", async () => {
    const me = await requireConsole();
    vi.stubEnv("DEVELOPER_EMAILS", me.email);
    const from = db({});
    await setErrorStatus(form({ id: ID, status: "deleted" }));
    await setErrorStatus(form({ id: "nope", status: "resolved" }));
    expect(from).not.toHaveBeenCalled();
  });
});

// GAPS A1.7 / A13: the grid homepage's section order and visibility.
describe("saveHomeSections", () => {
  const sectionsForm = (fields: Record<string, string>) => form({ order: "videos,member_news,supplier_logos,events,newsletters", show_member_news: "on", show_events: "on", show_newsletters: "on", ...fields });

  it("applies a move and stores the layout under home_sections", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await expect(saveHomeSections(sectionsForm({ move: "events:up" }))).rejects.toThrow("NEXT_REDIRECT:/console/pages?saved=sections#home-sections");

    expect(builder.upsert).toHaveBeenCalledWith({
      key: "home_sections",
      value: { order: ["videos", "member_news", "events", "supplier_logos", "newsletters"], hidden: [] },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("hides an unticked section, but never one carrying a paid placement", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    // show_videos / show_supplier_logos absent: a crafted POST trying to hide paid sections
    await expect(saveHomeSections(form({ order: "videos,member_news,supplier_logos,events,newsletters", show_member_news: "on" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(builder.upsert).toHaveBeenCalledWith({
      key: "home_sections",
      value: { order: ["videos", "member_news", "supplier_logos", "events", "newsletters"], hidden: ["events", "newsletters"] },
    });
  });

  it("ignores a move naming an unknown section", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await expect(saveHomeSections(sectionsForm({ move: "adverts:up" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(builder.upsert).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ order: ["videos", "member_news", "supplier_logos", "events", "newsletters"] }) }));
  });
});

// GAPS A8.2 / A28: the design every visitor gets, from the console.
describe("saveSiteVariant / clearMyVariantOverride", () => {
  afterEach(resetNextHeadersMocks);

  it("stores the chosen design under site_variant and revalidates every route", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await expect(saveSiteVariant(form({ variant: "grid" }))).rejects.toThrow("NEXT_REDIRECT:/console/pages?saved=variant");

    expect(builder.upsert).toHaveBeenCalledWith({ key: "site_variant", value: "grid" });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses anything that isn't one of the two designs, without writing", async () => {
    const from = db({});
    await expect(saveSiteVariant(form({ variant: "purple" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/pages\?error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("clearing the override deletes only this browser's switcher cookie", async () => {
    cookieStore.set("smi-theme", "forge");
    await expect(clearMyVariantOverride()).rejects.toThrow("NEXT_REDIRECT:/console/pages?saved=override");
    expect(cookieStore.has("smi-theme")).toBe(false);
  });
});

// Feature flags (/console/features, lib/feature-flags.ts).
describe("saveFeatureFlag", () => {
  it.each([
    ["on", true],
    ["off", false],
  ])("stores %s as a boolean under its own feature: key and revalidates the member area", async (state, value) => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await expect(saveFeatureFlag(form({ flag: "member_leads", state }))).rejects.toThrow(
      "NEXT_REDIRECT:/console/features?saved=member_leads",
    );

    expect(builder.upsert).toHaveBeenCalledWith({ key: "feature:member_leads", value });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it.each([
    [{ flag: "not_a_flag", state: "on" }],
    [{ flag: "member_leads", state: "maybe" }],
    [{ flag: "member_leads" }],
  ])("refuses an unknown flag or state without writing: %o", async (fields) => {
    const from = db({});
    await expect(saveFeatureFlag(form(fields))).rejects.toThrow(/NEXT_REDIRECT:\/console\/features\?error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of claiming it saved", async () => {
    db({ settings: () => queryBuilder(dbError("boom")) });
    await expect(saveFeatureFlag(form({ flag: "member_leads", state: "on" }))).rejects.toThrow(
      /NEXT_REDIRECT:\/console\/features\?error=/,
    );
  });

  it("is console-only: a refused requireConsole writes nothing", async () => {
    const from = db({});
    requireConsole.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/dashboard"));
    await expect(saveFeatureFlag(form({ flag: "member_leads", state: "on" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(from).not.toHaveBeenCalled();
  });
});

// Area 3 (Jas's 16 Oct flow chart): each story has its own social post time,
// lead-in and opt-out; times typed in the console are UK time.
describe("per-story social posts", () => {
  const NOW = new Date("2026-07-01T12:00:00Z");
  afterEach(() => vi.useRealTimers());
  const at = (iso: string) => new Date(iso);

  it.each([
    ["Publish now", () => scheduleStory(form({ id: "s1", mode: "now" })).catch(() => {})],
    ["Approve & publish now", () => decideStory(form({ id: "s1", decision: "approve" }))],
    ["dragging to Live", () => moveStory({ id: "s1", to: "published" })],
  ])("%s queues the post at the configured delay — the 30 minutes is no longer hard-coded", async (_how, act) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    db({
      stories: () => queryBuilder(dbOk({ id: "s1", member_id: null, status: "awaiting_approval", source: "admin", member_draft: false, social_at: null, social_posted_at: null, published_at: null })),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 45 } })),
    });

    await act();

    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, at("2026-07-01T12:45:00Z"));
  });

  it("approving queues the post for the story's own time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    db({
      stories: () => queryBuilder(dbOk({ id: "s1", member_id: null, status: "awaiting_approval", source: "admin", social_at: "2026-07-01T16:00:00Z", social_posted_at: null, published_at: null })),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 45 } })),
    });

    await decideStory(form({ id: "s1", decision: "approve" }));

    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, at("2026-07-01T16:00:00Z"));
  });

  it.each([
    ["2026-07-01T10:00", "2026-07-01T09:00:00.000Z"], // BST
    ["2026-01-15T10:00", "2026-01-15T10:00:00.000Z"], // GMT
  ])("reads the publish time %s as UK time", async (typed, stored) => {
    const storiesBuilder = queryBuilder(dbOk({ member_id: null, status: "draft" }));
    db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", scheduled_at: typed }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled", scheduled_at: stored }));
  });

  it("refuses a publish time it can't read instead of storing Invalid Date", async () => {
    const storiesBuilder = queryBuilder(dbOk({ member_id: null, status: "draft" }));
    db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", scheduled_at: "next tuesday" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?error=");
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("saving stores the post time as UK time, a lead-in left as the prefill as null, and the opt-out", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", cover_path: null, member_draft: false }));
    db({ stories: () => storiesBuilder, jobs: () => queryBuilder(dbOk([])) });

    await expect(saveStory(form({
      id: "s1", title: "T", social_at: "2026-07-01T10:00", social_text: "The summary.", social_text_default: "The summary.", social_skip: "on",
    }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?saved=1");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      social_at: "2026-07-01T09:00:00.000Z", social_text: null, social_skip: true,
    }));
  });

  it("saving refuses a lead-in over the budget before writing anything", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", cover_path: null, member_draft: false }));
    db({ stories: () => storiesBuilder });

    await expect(saveStory(form({ id: "s1", title: "T", social_at: "", social_text: "x".repeat(201) })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?error=");
    expect(storiesBuilder.update).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("saving moves a post that's already waiting to the edited time", async () => {
    const pending = queryBuilder(dbOk([{ id: "j1" }]));
    const update = queryBuilder(dbOk(null));
    let jobsCalls = 0;
    db({
      stories: () => queryBuilder(dbOk({ id: "s1", cover_path: null, member_draft: false, social_at: "2099-01-01T10:00:00Z", published_at: NOW.toISOString() })),
      jobs: () => (jobsCalls++ === 0 ? pending : update),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 45 } })),
    });

    await expect(saveStory(form({ id: "s1", title: "T", social_at: "2099-01-01T10:00" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ due_at: "2099-01-01T10:00:00.000Z" }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("taking a live story off the site drops its waiting post", async () => {
    const jobs = queryBuilder(dbOk(null));
    db({
      stories: () => queryBuilder(dbOk({ id: "s1", status: "published", member_id: null, member_draft: false, source: "admin" })),
      jobs: () => jobs,
    });

    expect(await moveStory({ id: "s1", to: "draft" })).toEqual({ ok: true });

    expect(jobs.delete).toHaveBeenCalled();
    expect(jobs.filter).toHaveBeenCalledWith("payload->>story_id", "eq", "s1");
  });
});

describe("saveStory — SMI's post links filled from Buffer", () => {
  it("saving a form opened before Buffer's link arrived keeps the link", async () => {
    const LI = "https://www.linkedin.com/feed/update/urn:li:share:1";
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", cover_path: null, member_draft: false, social_posts: { linkedin: LI } }));
    db({ stories: () => storiesBuilder, jobs: () => queryBuilder(dbOk([])) });

    await expect(saveStory(form({ id: "s1", title: "T", post_linkedin: "", post_linkedin_was: "", post_facebook: "", post_facebook_was: "", post_x: "", post_x_was: "" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?saved=1");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ social_posts: { linkedin: LI } }));
  });
});
