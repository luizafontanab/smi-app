import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consoleUploadVideoImage, decideVideo, moveVideo, pinVideo, returnToDraft, saveVideo, scheduleVideo,
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
});

describe("saveVideo", () => {
  it("does nothing without both a title and a url", async () => {
    const from = db({});
    await saveVideo(form({ title: "t", url: "" }));
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
    uploadImage.mockRejectedValue(new Error("Images only"));
    const from = db({});

    await expect(saveVideo(form({ id: "v1", title: "t", url: "https://x" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/videos/v1?error=Images%20only");
    expect(from).not.toHaveBeenCalled();
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

  it("rejecting stamps a reason and notifies the member", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", member_id: "m1", status: "awaiting_approval" }));
    db({ videos: () => videosBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideVideo(form({ id: "v1", decision: "reject", reason: "Poor audio" }));

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", rejected_reason: "Poor audio" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "video_rejected" }));
  });
});

describe("moveVideo", () => {
  it("refuses a move the matrix doesn't allow, and says why", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "awaiting_approval", member_id: "m1" }));
    db({ videos: () => videosBuilder });

    const res = await moveVideo({ id: "v1", to: "draft" });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("awaiting_approval");
    expect(videosBuilder.update).not.toHaveBeenCalled();
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
