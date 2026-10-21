import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consoleUploadVideoImage, decideVideo, moveVideo, pinVideo, returnToDraft, saveVideo, scheduleVideo, setVideoStatus,
} from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, uploadImage, enqueue } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue }));

afterEach(() => {
  resetDbServerMocks();
  uploadImage.mockReset().mockResolvedValue(null);
  enqueue.mockReset().mockResolvedValue(undefined);
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("consoleUploadVideoImage", () => {
  it("uploads under videos/console", async () => {
    await consoleUploadVideoImage(form({}));
    expect(uploadImage).toHaveBeenCalledWith(null, "videos/console");
  });

  it("returns the refusal reason as a value instead of throwing", async () => {
    uploadImage.mockRejectedValue(new Error("Image too large (8MB max)"));
    expect(await consoleUploadVideoImage(form({}))).toEqual({ error: "Image too large (8MB max)" });
  });
});

describe("saveVideo", () => {
  // See the note in console-actions-stories.test.ts — fix-list 73 turned these
  // silent returns into a redirect that tells you what is missing.
  it("redirects with a readable error without both a title and a url", async () => {
    const from = db({});
    await expect(saveVideo(form({ title: "t", url: "" }))).rejects.toThrow(/NEXT_REDIRECT.*error=/);
    expect(from).not.toHaveBeenCalled();
  });

  // USE-CASES gap 23: YouTube only, same rule as the member form.
  it("refuses a link that isn't YouTube and never touches the database", async () => {
    const from = db({});
    await expect(saveVideo(form({ id: "v1", title: "t", url: "https://vimeo.com/123" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/videos\/v1\?error=.*YouTube/);
    expect(from).not.toHaveBeenCalled();
  });

  it("creates a new video as a draft and redirects to it", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1" }));
    db({ videos: () => videosBuilder });

    await expect(saveVideo(form({ title: "New Video", url: "https://youtube.com/watch?v=x" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/videos/v1");

    expect(videosBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", source: "manual" }));
  });

  // videos.industry_id existed since 20260909000002 but nothing wrote it until
  // this form gained the field (fix list).
  it("writes industry_id, and null when nothing is chosen", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1" }));
    db({ videos: () => videosBuilder });

    await expect(saveVideo(form({ id: "v1", title: "T", url: "https://youtu.be/x", industry_id: "4" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/videos/v1");
    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ industry_id: 4 }));

    await expect(saveVideo(form({ id: "v1", title: "T", url: "https://youtu.be/x", industry_id: "" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/videos/v1");
    expect(videosBuilder.update).toHaveBeenLastCalledWith(expect.objectContaining({ industry_id: null }));
  });

  it("redirects with the thumbnail upload error and never touches the database", async () => {
    uploadImage.mockRejectedValue(new Error("Images only — JPEG, PNG, WebP, GIF or AVIF."));
    const from = db({});

    await expect(saveVideo(form({ id: "v1", title: "t", url: "https://youtu.be/x" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/videos/v1?error=Images%20only");
    expect(from).not.toHaveBeenCalled();
  });

  // A storage failure's own text (bucket names, paths) stays in the error log.
  it("a storage failure shows a plain line, not the provider's text", async () => {
    uploadImage.mockRejectedValue(new Error('new row violates row-level security policy for table "objects"'));
    db({});
    await expect(saveVideo(form({ id: "v1", title: "t", url: "https://youtu.be/x" })))
      .rejects.toThrow(/v1\?error=The%20upload%20didn't%20go%20through/);
  });
});

describe("scheduleVideo", () => {
  it("publishing now enqueues social push and, when there's a member, a notification", async () => {
    const videosBuilder = queryBuilder(dbOk({ member_id: "m1" }));
    db({ videos: () => videosBuilder });

    await expect(scheduleVideo(form({ id: "v1", mode: "now" }))).rejects.toThrow("NEXT_REDIRECT:/console/videos");

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(enqueue).toHaveBeenCalledWith("social_push", { video_id: "v1" }, expect.any(Date));
  });

  it("rejects a return_to outside the video board", async () => {
    db({ videos: () => queryBuilder(dbOk(null)) });
    await expect(scheduleVideo(form({ id: "v1", return_to: "//evil.example" }))).rejects.toThrow("NEXT_REDIRECT:/console/videos");
  });

  it("scheduling for later from awaiting_approval also records the approval, without publishing yet", async () => {
    const videosBuilder = queryBuilder(dbOk({ member_id: "m1", status: "awaiting_approval" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ videos: () => videosBuilder, approvals: () => approvalsBuilder });

    await expect(scheduleVideo(form({ id: "v1", scheduled_at: "2026-09-01T10:00" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "video", decision: "approved", decided_by: "admin1" }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not record an approval when scheduling from a status other than awaiting_approval", async () => {
    const videosBuilder = queryBuilder(dbOk({ member_id: "m1", status: "draft" }));
    const from = db({ videos: () => videosBuilder });

    await expect(scheduleVideo(form({ id: "v1", scheduled_at: "2026-09-01T10:00" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(from).not.toHaveBeenCalledWith("approvals");
  });
});

describe("decideVideo", () => {
  it("ignores a video that isn't awaiting approval", async () => {
    const from = db({ videos: () => queryBuilder(dbOk({ id: "v1", status: "published" })) });
    await decideVideo(form({ id: "v1", decision: "approve" }));
    expect(from).not.toHaveBeenCalledWith("approvals");
  });

  // Regression guard for the "member did not get notified of video approval"
  // report (fix list). The approve branch was untested — only reject was — so
  // nothing would have caught the enqueue going missing. The report itself
  // turned out to be an undrained local job queue, not a defect here, but the
  // approve path deserves the same cover its sibling has.
  it("approving publishes and notifies the member that the video is live", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", member_id: "m1", status: "awaiting_approval" }));
    db({ videos: () => videosBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideVideo(form({ id: "v1", decision: "approve" }));

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "video_live", member_id: "m1", video_id: "v1" }));
  });

  it("does not notify when the video has no member", async () => {
    db({
      videos: () => queryBuilder(dbOk({ id: "v1", member_id: null, status: "awaiting_approval" })),
      approvals: () => queryBuilder(dbOk(null)),
    });

    await decideVideo(form({ id: "v1", decision: "approve" }));

    expect(enqueue).not.toHaveBeenCalledWith("notify_member", expect.anything());
  });

  it("rejecting a member's video stamps a reason and notifies the member", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", member_id: "m1", status: "awaiting_approval", source: "member" }));
    db({ videos: () => videosBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideVideo(form({ id: "v1", decision: "reject", reason: "Poor audio" }));

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", rejected_reason: "Poor audio" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "video_rejected" }));
  });

  // The desk's own video names a member it is *about*; "not yet" must not
  // email them a rejection for something they never sent in (20 Oct).
  it("'not yet' on the desk's own video puts it back to draft and emails nobody", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", member_id: "m1", status: "awaiting_approval", source: "admin" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ videos: () => videosBuilder, approvals: () => approvalsBuilder });

    await decideVideo(form({ id: "v1", decision: "reject" }));

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
    expect(videosBuilder.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: "rejected" }));
    expect(enqueue).not.toHaveBeenCalled();
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "video", decision: "rejected" }));
  });
});

describe("moveVideo", () => {
  it("refuses a move the matrix doesn't allow, and says why", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "awaiting_approval", member_id: "m1", source: "admin" }));
    db({ videos: () => videosBuilder });

    const res = await moveVideo({ id: "v1", to: "scheduled" });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("awaiting_approval");
    expect(videosBuilder.update).not.toHaveBeenCalled();
  });

  it("won't drag a member's submission back to draft — that's Send back, with a reason", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "awaiting_approval", member_id: "m1", source: "member" }));
    db({ videos: () => videosBuilder });

    const res = await moveVideo({ id: "v1", to: "draft" });

    expect(res).toEqual({ ok: false, error: expect.stringContaining("sent back from its editor") });
    expect(videosBuilder.update).not.toHaveBeenCalled();
  });

  it("drags the desk's own video from review back to draft, recording the 'not yet'", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "awaiting_approval", member_id: "m1", source: "admin" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ videos: () => videosBuilder, approvals: () => approvalsBuilder });

    expect(await moveVideo({ id: "v1", to: "draft" })).toEqual({ ok: true });
    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "video", decision: "rejected" }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("reads the current status from the DB, not from the caller", async () => {
    db({ videos: () => queryBuilder(dbOk(null)) });
    const res = await moveVideo({ id: "nope", to: "draft" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Video not found.");
  });

  // Dragging to Published must be the same code path as clicking Approve:
  // social push, member notification and an approvals row for the audit trail.
  it("publishing from awaiting_approval notifies, pushes and records the approval", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "awaiting_approval", member_id: "m1" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ videos: () => videosBuilder, approvals: () => approvalsBuilder });

    const res = await moveVideo({ id: "v1", to: "published" });

    expect(res.ok).toBe(true);
    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(enqueue).toHaveBeenCalledWith("social_push", { video_id: "v1" }, expect.any(Date));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "video_live" }));
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "video", decision: "approved" }));
  });

  it("publishing a draft records no approval — there was no member decision to make", async () => {
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ videos: () => queryBuilder(dbOk({ id: "v1", status: "draft", member_id: null })), approvals: () => approvalsBuilder });

    await moveVideo({ id: "v1", to: "published" });

    expect(approvalsBuilder.insert).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalledWith("notify_member", expect.anything());
  });

  // Leaving published must clear published_at, or a draft row keeps claiming a
  // publication date it no longer has.
  it("returning a published video to draft clears published_at", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "published", member_id: "m1" }));
    db({ videos: () => videosBuilder });

    const res = await moveVideo({ id: "v1", to: "draft" });

    expect(res.ok).toBe(true);
    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", published_at: null }));
  });

  it("a scheduled → draft move leaves published_at alone", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "scheduled", member_id: "m1" }));
    db({ videos: () => videosBuilder });

    await moveVideo({ id: "v1", to: "draft" });

    const [payload] = (videosBuilder.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).not.toHaveProperty("published_at");
  });
});

describe("returnToDraft", () => {
  it("ignores an unknown kind", async () => {
    const from = db({});
    await returnToDraft(form({ id: "v1", kind: "newsletter" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("takes a published video back to draft via the board matrix", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "published", member_id: "m1" }));
    db({ videos: () => videosBuilder });

    await expect(returnToDraft(form({ id: "v1", kind: "video" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/videos/v1");

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", published_at: null }));
  });

  // featured_machines has no updated_at column at all — stamping one fails the
  // whole update, which is why this action branches per table.
  it("does not stamp updated_at on a machine, which has no such column", async () => {
    const machinesBuilder = queryBuilder(dbOk({ id: "fm1", status: "published" }));
    db({ featured_machines: () => machinesBuilder });

    await expect(returnToDraft(form({ id: "fm1", kind: "machine" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/machines/fm1");

    expect(machinesBuilder.update).toHaveBeenCalledWith({ status: "draft" });
  });

  it("leaves an already-draft event alone", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1", status: "draft" }));
    db({ events: () => eventsBuilder });

    await returnToDraft(form({ id: "e1", kind: "event" }));

    expect(eventsBuilder.update).not.toHaveBeenCalled();
  });
});

describe("pinVideo", () => {
  it("clears pinned_until for zero days", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ videos: () => builder });
    await pinVideo(form({ id: "v1", days: "0" }));
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ pinned_until: null }));
  });
});

describe("setVideoStatus", () => {
  it("comes back to the video's own editor when it asked to (Mark ready to review)", async () => {
    db({ videos: () => queryBuilder(dbOk({ id: "v1", status: "draft", member_id: null, source: "admin" })) });
    await expect(setVideoStatus(form({ id: "v1", status: "awaiting_approval", return_to: "/console/videos/v1" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/videos/v1");
  });

  it("ignores a return_to that isn't this video's editor, as before", async () => {
    db({ videos: () => queryBuilder(dbOk({ id: "v1", status: "draft", member_id: null, source: "admin" })) });
    await expect(setVideoStatus(form({ id: "v1", status: "awaiting_approval", return_to: "https://evil.example" }))).resolves.toBeUndefined();
  });
});

// Area 3: videos get the same per-item social post and UK-time handling as stories.
describe("per-video social posts", () => {
  afterEach(() => vi.useRealTimers());

  it("publishing now queues the post at the configured delay, not a hard-coded 30 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    db({
      videos: () => queryBuilder(dbOk({ member_id: null, status: "draft", social_at: null, social_posted_at: null, published_at: null })),
      settings: () => queryBuilder(dbOk({ value: { delay_minutes: 45 } })),
    });

    await expect(scheduleVideo(form({ id: "v1", mode: "now" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(enqueue).toHaveBeenCalledWith("social_push", { video_id: "v1" }, new Date("2026-07-01T12:45:00Z"));
  });

  it("reads the publish time as UK time", async () => {
    const videos = queryBuilder(dbOk({ member_id: null, status: "draft" }));
    db({ videos: () => videos });

    await expect(scheduleVideo(form({ id: "v1", scheduled_at: "2026-07-01T10:00" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(videos.update).toHaveBeenCalledWith(expect.objectContaining({ scheduled_at: "2026-07-01T09:00:00.000Z" }));
  });

  it("saving writes the lead-in, post time and opt-out", async () => {
    const videos = queryBuilder(dbOk({ id: "v1" }));
    db({ videos: () => videos, jobs: () => queryBuilder(dbOk([])) });

    await expect(saveVideo(form({
      id: "v1", title: "T", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      social_at: "", social_text: "Watch the new line run.", social_text_default: "Description.",
    }))).rejects.toThrow("NEXT_REDIRECT:/console/videos/v1?saved=1");

    expect(videos.update).toHaveBeenCalledWith(expect.objectContaining({ social_text: "Watch the new line run.", social_at: null, social_skip: false }));
  });

  it("taking a live video off the site drops its waiting post", async () => {
    const jobs = queryBuilder(dbOk(null));
    db({ videos: () => queryBuilder(dbOk({ id: "v1", status: "published", member_id: null, source: "manual" })), jobs: () => jobs });

    expect(await moveVideo({ id: "v1", to: "draft" })).toEqual({ ok: true });

    expect(jobs.delete).toHaveBeenCalled();
    expect(jobs.filter).toHaveBeenCalledWith("payload->>video_id", "eq", "v1");
  });
});
