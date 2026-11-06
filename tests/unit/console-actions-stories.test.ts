import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmStorySocial, consoleUploadImage, decideStory, moveStory, pinStory, saveSocialCaps, saveStory, scheduleStory, setStoryStatus,
  saveSiteVariant, clearMyVariantOverride, saveHomeSections, setErrorStatus, saveFeatureFlag,
} from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, readThenUpdate, sequence } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { UPLOAD_EXPIRED } from "@/lib/upload-limits";
import { revalidatePath } from "next/cache";
import type { CurrentUser } from "@/lib/auth";
import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";
import { LIFECYCLE_MESSAGES } from "@/lib/content-lifecycle";
import { CONFIRM_MESSAGES } from "@/lib/social-push";
import { channelPosts } from "@/lib/adapters/social";
import { postFingerprint, storySocialItem } from "@/lib/social-post";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, uploadImage, removeMedia, removeMediaIfUnused, enqueue } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  removeMedia: vi.fn<(path: string | null | undefined) => Promise<void>>(async () => {}),
  removeMediaIfUnused: vi.fn<(paths: readonly (string | null | undefined)[]) => Promise<void>>(async () => {}),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia, removeMediaIfUnused }));
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
    const storiesBuilder = readThenUpdate({ id: "s1", cover_path: null, member_draft: false });
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
    const storiesBuilder = readThenUpdate({ id: "s1", cover_path: null, member_draft: false });
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
    const storiesBuilder = readThenUpdate({ id: "s1", cover_path: null, member_draft: false });
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
    const storiesBuilder = readThenUpdate({ id: "s1", cover_path: "old.jpg" });
    db({ stories: () => storiesBuilder });
    uploadImage.mockResolvedValue("new.jpg");

    await expect(saveStory(form({ id: "s1", title: "Updated" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/s1");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ title: "Updated", cover_path: "new.jpg" }));
    // Through the in-use check: the media library lets the desk reuse a cover on another story.
    expect(removeMediaIfUnused).toHaveBeenCalledWith(["old.jpg"]);
    expect(removeMedia).not.toHaveBeenCalledWith("old.jpg");
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
    const storiesBuilder = readThenUpdate({ id: "s1" });
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
  it("publishes immediately and notifies the member, but queues no social post nobody confirmed", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "draft" }));
    db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", mode: "now" }))).rejects.toThrow(/^NEXT_REDIRECT:\/console\/stories$/);

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(enqueue).not.toHaveBeenCalledWith("social_push", expect.anything(), expect.anything());
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "story_live" }));
  });

  it("schedules for later without touching jobs directly", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: null, status: "draft" }));
    db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", scheduled_at: "2026-09-01T10:00" }))).rejects.toThrow(/^NEXT_REDIRECT:\/console\/stories$/);

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

    await expect(scheduleStory(form({ id: "s1", scheduled_at: "2026-09-01T10:00" }))).rejects.toThrow(/^NEXT_REDIRECT:\/console\/stories$/);

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "story", decision: "approved", decided_by: "admin1" }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("publishing now from awaiting_approval also records the approval", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, approvals: () => approvalsBuilder });

    await expect(scheduleStory(form({ id: "s1", mode: "now" }))).rejects.toThrow(/^NEXT_REDIRECT:\/console\/stories$/);

    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "story", decision: "approved" }));
  });

  it("Approve & schedule saves the editor's Industry box in the scheduling write", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval", source: "member", industry_id: null }));
    db({ stories: () => storiesBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await expect(scheduleStory(form({ id: "s1", scheduled_at: "2026-09-01T10:00", industry_id: "5" }))).rejects.toThrow(/^NEXT_REDIRECT:\/console\/stories$/);

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled", industry_id: 5 }));
  });

  it("does not record an approval when scheduling from a status other than awaiting_approval", async () => {
    const storiesBuilder = queryBuilder(dbOk({ member_id: "m1", status: "draft" }));
    const from = db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", scheduled_at: "2026-09-01T10:00" }))).rejects.toThrow(/^NEXT_REDIRECT:\/console\/stories$/);

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(from).not.toHaveBeenCalledWith("approvals");
  });
});

describe("scheduleStory — a refusal says why on the editor (Q8, Q12)", () => {
  const errorAt = (path: string, message: string) => `NEXT_REDIRECT:${path}?error=${encodeURIComponent(message)}`;

  it("Publish now on a Live story is refused on its editor, with nothing written or queued", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "published", source: "admin" }));
    const from = db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", mode: "now" })))
      .rejects.toThrow(errorAt("/console/stories/s1", LIFECYCLE_MESSAGES.cantPublish("story", "Live")));
    expect(storiesBuilder.update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("approvals");
  });

  it("scheduling a Withdrawn story is refused on its editor", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "withdrawn", source: "member" }));
    db({ stories: () => storiesBuilder });

    await expect(scheduleStory(form({ id: "s1", scheduled_at: "2026-09-01T10:00" })))
      .rejects.toThrow(errorAt("/console/stories/s1", LIFECYCLE_MESSAGES.cantPublish("story", "Withdrawn")));
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("a story that isn't there goes back to the list, not to an editor that can't open", async () => {
    db({ stories: () => queryBuilder(dbOk(null)) });

    await expect(scheduleStory(form({ id: "gone", mode: "now" })))
      .rejects.toThrow(errorAt("/console/stories", LIFECYCLE_MESSAGES.notFound("story")));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a failed publish write says so on the editor, and queues no post or email", async () => {
    db({ stories: sequence(dbOk({ id: "s1", member_id: "m1", status: "draft", source: "admin" }), dbError("boom")) });

    await expect(scheduleStory(form({ id: "s1", mode: "now" })))
      .rejects.toThrow(errorAt("/console/stories/s1", LIFECYCLE_MESSAGES.publishFailed("story")));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a publish that matched no row (someone else moved it) is 'changed', with nothing queued", async () => {
    db({ stories: sequence(dbOk({ id: "s1", member_id: "m1", status: "draft", source: "admin" }), dbOk(null)) });

    await expect(scheduleStory(form({ id: "s1", mode: "now" })))
      .rejects.toThrow(errorAt("/console/stories/s1", LIFECYCLE_MESSAGES.changed));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("with neither Publish now nor a time, it just goes back without touching the story", async () => {
    const from = db({});

    await expect(scheduleStory(form({ id: "s1" }))).rejects.toThrow(/^NEXT_REDIRECT:\/console\/stories$/);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("decideStory", () => {
  const errorAt = (path: string, message: string) => `NEXT_REDIRECT:${path}?error=${encodeURIComponent(message)}`;

  // Was a silent no-op; now the editor says why (Q12). Approve on a Live story
  // is the publish refusal (Q8); a decline on one is "already decided".
  it("approving a story that's already Live is refused on its editor, with no approval recorded", async () => {
    const from = db({ stories: () => queryBuilder(dbOk({ id: "s1", status: "published" })) });
    await expect(decideStory(form({ id: "s1", decision: "approve" })))
      .rejects.toThrow(errorAt("/console/stories/s1", LIFECYCLE_MESSAGES.alreadyDecided("story")));
    expect(from).not.toHaveBeenCalledWith("approvals");
    expect(enqueue).not.toHaveBeenCalled();
  });

  // A stale tab: another admin Sent it back first. Approve must not publish it
  // and email the member that it's live.
  it("approving a story another admin already Sent back is refused, and nothing is published or sent", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "rejected", source: "member", member_id: "m1" }));
    const from = db({ stories: () => storiesBuilder });
    await expect(decideStory(form({ id: "s1", decision: "approve" })))
      .rejects.toThrow(errorAt("/console/stories/s1", LIFECYCLE_MESSAGES.alreadyDecided("story")));
    expect(storiesBuilder.update).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("approvals");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("sending back a story that's already been decided is refused on its editor", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "published", source: "member", member_id: "m1" }));
    const from = db({ stories: () => storiesBuilder });
    await expect(decideStory(form({ id: "s1", decision: "reject", reason: "Late" })))
      .rejects.toThrow(errorAt("/console/stories/s1", LIFECYCLE_MESSAGES.alreadyDecided("story")));
    expect(storiesBuilder.update).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("approvals");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a story that isn't there goes back to the list with the error", async () => {
    db({ stories: () => queryBuilder(dbOk(null)) });
    await expect(decideStory(form({ id: "gone", decision: "approve" })))
      .rejects.toThrow(errorAt("/console/stories", LIFECYCLE_MESSAGES.notFound("story")));
  });

  it("sending back a member's story with no reason is refused on its editor (Q10)", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval", source: "member" }));
    const from = db({ stories: () => storiesBuilder });
    await expect(decideStory(form({ id: "s1", decision: "reject", reason: "  " })))
      .rejects.toThrow(errorAt("/console/stories/s1", LIFECYCLE_MESSAGES.reasonRequired));
    expect(storiesBuilder.update).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("approvals");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a failed approve write is shown on the editor, with no post, email or approval (Q3)", async () => {
    const from = db({ stories: sequence(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval", source: "member" }), dbError("boom")) });
    await expect(decideStory(form({ id: "s1", decision: "approve" })))
      .rejects.toThrow(errorAt("/console/stories/s1", LIFECYCLE_MESSAGES.publishFailed("story")));
    expect(enqueue).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("approvals");
  });

  // Review fix, 3 Nov: member stories arrive untagged, and the editor's Industry
  // box lives in the Save form. Its Approve buttons now carry the box's value
  // (MirrorInput), saved in the same write that publishes.
  it("approving from the editor saves the Industry box with the publish", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval", source: "member", industry_id: null }));
    db({ stories: () => storiesBuilder, members: () => queryBuilder(dbOk({ industry_id: 4 })), approvals: () => queryBuilder(dbOk(null)) });
    await decideStory(form({ id: "s1", decision: "approve", industry_id: "7" }));
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published", industry_id: 7 }));
  });

  it("approving from the editor with '— none —' saves no industry", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval", source: "member", industry_id: null }));
    db({ stories: () => storiesBuilder, members: () => queryBuilder(dbOk({ industry_id: 4 })), approvals: () => queryBuilder(dbOk(null)) });
    await decideStory(form({ id: "s1", decision: "approve", industry_id: "" }));
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published", industry_id: null }));
  });

  it("approving from the board (no Industry box) tags a member's untagged story with the member's industry", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval", source: "member", industry_id: null }));
    db({ stories: () => storiesBuilder, members: () => queryBuilder(dbOk({ industry_id: 4 })), approvals: () => queryBuilder(dbOk(null)) });
    await decideStory(form({ id: "s1", decision: "approve" }));
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published", industry_id: 4 }));
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

    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "rejected", rejected_reason: "Needs a photo", updated_at: expect.any(String) });
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

    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "draft", updated_at: expect.any(String) });
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
    await expect(scheduleStory(form({ id: "s1", mode: "now" })))
      .rejects.toThrow(`NEXT_REDIRECT:/console/stories?error=${encodeURIComponent(LIFECYCLE_MESSAGES.notFound("story"))}`);
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
    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "awaiting_approval", updated_at: expect.any(String) });
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
    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "draft", updated_at: expect.any(String) });
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

  it("a stale drag that matched no row says the story changed, and queues nothing (Q11)", async () => {
    db({ stories: sequence(dbOk({ id: "s1", status: "draft", member_id: "m1", member_draft: false }), dbOk(null)) });
    expect(await moveStory({ id: "s1", to: "published" })).toEqual({ ok: false, error: LIFECYCLE_MESSAGES.changed });
    expect(enqueue).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
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
  /**
   * The story as the lifecycle reads it, then — once it has written it Live —
   * as the push reads it back; one channel, confirmed before it went Live.
   */
  function goingLive(row: Record<string, unknown>) {
    const before = queryBuilder(dbOk({ id: "s1", member_id: null, status: "awaiting_approval", source: "admin", member_draft: false, social_at: null, published_at: null, ...row }));
    const after = queryBuilder(dbOk({ status: "published", social_skip: false, social_at: null, published_at: NOW.toISOString(), ...row }));
    db({
      stories: () => ((before.update as ReturnType<typeof vi.fn>).mock.calls.length ? after : before),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 45, channelIds: ["li"] } })),
      social_channel_posts: () => queryBuilder(dbOk([{ channel_id: "li", skip: false, posted_at: null, confirmed_at: "2026-07-01T09:00:00Z" }])),
    });
  }

  it.each([
    ["Publish now", () => scheduleStory(form({ id: "s1", mode: "now" })).catch(() => {})],
    ["Approve & publish now", () => decideStory(form({ id: "s1", decision: "approve" }))],
    ["dragging to Live", () => moveStory({ id: "s1", to: "published" })],
  ])("%s queues a confirmed post at the configured delay — the 30 minutes is no longer hard-coded", async (_how, act) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    goingLive({});

    await act();

    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, at("2026-07-01T12:45:00Z"));
  });

  it("approving queues a confirmed post for the story's own time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    goingLive({ social_at: "2026-07-01T16:00:00Z" });

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
    const storiesBuilder = readThenUpdate({ id: "s1", cover_path: null, member_draft: false });
    db({ stories: () => storiesBuilder, jobs: () => queryBuilder(dbOk([])) });

    await expect(saveStory(form({
      id: "s1", title: "T", social_at: "2026-07-01T10:00", social_text: "The summary.", social_text_default: "The summary.", social_skip: "on",
    }))).rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?saved=1");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      social_at: "2026-07-01T09:00:00.000Z", social_text: null, social_skip: true,
    }));
  });

  it("saving refuses a lead-in over the budget before writing anything", async () => {
    const storiesBuilder = readThenUpdate({ id: "s1", cover_path: null, member_draft: false });
    db({ stories: () => storiesBuilder });

    await expect(saveStory(form({ id: "s1", title: "T", social_at: "", social_text: "x".repeat(201) })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?error=");
    expect(storiesBuilder.update).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("saving moves a confirmed post to the edited time", async () => {
    const jobs = queryBuilder(dbOk(null));
    db({
      stories: () => readThenUpdate({ id: "s1", cover_path: null, member_draft: false, status: "published", social_skip: false, social_at: "2099-01-01T10:00:00Z", published_at: NOW.toISOString() }),
      jobs: () => jobs,
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 45, channelIds: ["li"] } })),
      social_channel_posts: () => queryBuilder(dbOk([{ channel_id: "li", skip: false, posted_at: null, confirmed_at: "2026-07-01T09:00:00Z" }])),
    });

    await expect(saveStory(form({ id: "s1", title: "T", social_at: "2099-01-01T10:00" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(jobs.delete).toHaveBeenCalled();
    // through the real job queue, as Confirm does, so a due post runs at once in development too
    expect(enqueue).toHaveBeenCalledWith("social_push", { story_id: "s1" }, new Date("2099-01-01T10:00:00.000Z"));
  });

  it("saving queues no post for a Live story nobody confirmed", async () => {
    const jobs = queryBuilder(dbOk(null));
    db({
      stories: () => readThenUpdate({ id: "s1", cover_path: null, member_draft: false, status: "published", social_skip: false, social_at: null, published_at: "2020-01-01T09:00:00Z" }),
      jobs: () => jobs,
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 45, channelIds: ["li"] } })),
      social_channel_posts: () => queryBuilder(dbOk([])),
    });

    await expect(saveStory(form({ id: "s1", title: "T", social_at: "" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(jobs.insert).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalledWith("social_push", expect.anything(), expect.anything());
  });

  it("saving stores each listed channel's Don't post box, ticked or not", async () => {
    const rows = queryBuilder(dbOk([]));
    db({
      stories: () => readThenUpdate({ id: "s1", cover_path: null, member_draft: false }),
      jobs: () => queryBuilder(dbOk(null)),
      social_channel_posts: () => rows,
    });
    const fd = form({ id: "s1", title: "T", social_at: "" });
    fd.append("social_channel", "li");
    fd.append("social_channel", "x");
    fd.append("social_skip_channel", "x");

    await expect(saveStory(fd)).rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?saved=1");

    expect(rows.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({ story_id: "s1", channel_id: "li", skip: false }),
        expect.objectContaining({ story_id: "s1", channel_id: "x", skip: true }),
      ],
      { onConflict: "story_id,channel_id" },
    );
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
    const storiesBuilder = readThenUpdate({ id: "s1", cover_path: null, member_draft: false, social_posts: { linkedin: LI } });
    db({ stories: () => storiesBuilder, jobs: () => queryBuilder(dbOk([])) });

    await expect(saveStory(form({ id: "s1", title: "T", post_linkedin: "", post_linkedin_was: "", post_facebook: "", post_facebook_was: "", post_x: "", post_x_was: "" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/stories/s1?saved=1");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ social_posts: { linkedin: LI } }));
  });
});

// Issue #43: an admin confirms what each channel will receive, from the saved story.
describe("confirmStorySocial", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const story = {
    id: ID, title: "Acme wins award", slug: "acme-wins-award", cover_path: null, member_id: null, status: "draft",
    social_at: null, social_text: null, social_skip: false, published_at: null, summary: "Acme took the top prize.", member: null,
  };
  /** The fingerprints the editor showed for this story: no Buffer here, so every channel gets the one fallback text. */
  type Story = Omit<typeof story, "social_text"> & { social_text: string | null };
  const seen = (s: Story = story) => Object.fromEntries(
    channelPosts(storySocialItem(s, []).post, ["li", "x"], { kind: "unknown" })
      .map(({ post }) => [`social_seen:${post.channelId}`, postFingerprint(post)]),
  );
  const confirmDb = (rows: ReturnType<typeof queryBuilder>, s: Story = story) => db({
    stories: () => queryBuilder(dbOk(s)),
    story_members: () => queryBuilder(dbOk([])),
    settings: () => queryBuilder(dbOk({ value: { channelIds: ["li", "x"] } })),
    social_channel_posts: () => rows,
    jobs: () => queryBuilder(dbOk(null)),
  });

  it("confirms every waiting channel as the signed-in admin and comes back to the editor", async () => {
    const rows = queryBuilder(dbOk([]));
    confirmDb(rows);

    await expect(confirmStorySocial(form({ id: ID, confirm_channel: "all", title: "edited but unsaved", ...seen() })))
      .rejects.toThrow(`NEXT_REDIRECT:/console/stories/${ID}?confirmed=2#social`);

    const [upserted] = (rows.upsert as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [{ channel_id: string; confirmed_by: string; confirmed_text: string }[]];
    expect(upserted.map((r) => r.channel_id)).toEqual(["li", "x"]);
    expect(upserted[0].confirmed_by).toBe("admin1");
    // the saved story, not the form
    expect(upserted[0].confirmed_text).toMatch(/^Acme took the top prize\./);
    expect(revalidatePath).toHaveBeenCalledWith("/console");
  });

  it("refuses, with nothing stored, when the story changed after the editor loaded", async () => {
    const rows = queryBuilder(dbOk([]));
    // the page was built before another admin saved a new lead-in
    confirmDb(rows, { ...story, social_text: "Another admin's lead-in." });

    await expect(confirmStorySocial(form({ id: ID, confirm_channel: "x", ...seen() })))
      .rejects.toThrow(`NEXT_REDIRECT:/console/stories/${ID}?error=${encodeURIComponent(CONFIRM_MESSAGES.changed)}#social`);
    expect(rows.upsert).not.toHaveBeenCalled();
  });

  it("comes back to the editor with a message, not an error page, when saving the confirmation fails", async () => {
    confirmDb(queryBuilder(dbError("connection lost")));

    await expect(confirmStorySocial(form({ id: ID, confirm_channel: "all", ...seen() })))
      .rejects.toThrow(new RegExp(`^NEXT_REDIRECT:/console/stories/${ID}\\?error=.*#social$`));
  });

  it("says so when there are no channels to confirm", async () => {
    db({
      stories: () => queryBuilder(dbOk(story)),
      story_members: () => queryBuilder(dbOk([])),
      settings: () => queryBuilder(dbOk({ value: {} })),
    });

    await expect(confirmStorySocial(form({ id: ID, confirm_channel: "all" })))
      .rejects.toThrow(`NEXT_REDIRECT:/console/stories/${ID}?error=${encodeURIComponent(CONFIRM_MESSAGES.noChannels)}#social`);
  });

  it("refuses a malformed id without touching the database", async () => {
    const from = db({});
    await expect(confirmStorySocial(form({ id: "nope", confirm_channel: "all" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories?error=");
    expect(from).not.toHaveBeenCalled();
  });
});
