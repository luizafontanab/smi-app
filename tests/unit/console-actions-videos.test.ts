import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleUploadVideoImage, decideVideo, pinVideo, saveVideo, scheduleVideo } from "@/app/console/actions";
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

  it("rejecting stamps a reason and notifies the member", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", member_id: "m1", status: "awaiting_approval" }));
    db({ videos: () => videosBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideVideo(form({ id: "v1", decision: "reject", reason: "Poor audio" }));

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", rejected_reason: "Poor audio" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "video_rejected" }));
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
