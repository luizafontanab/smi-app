import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consoleUploadImage, decideStory, moveStory, pinStory, saveSocialCaps, saveStory, scheduleStory, setStoryStatus,
} from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { revalidatePath } from "next/cache";
import type { CurrentUser } from "@/lib/auth";

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

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("consoleUploadImage", () => {
  it("uploads under stories/console and returns a public URL", async () => {
    uploadImage.mockResolvedValue("stories/console/a.jpg");
    expect(await consoleUploadImage(form({}))).toContain("stories/console/a.jpg");
    expect(uploadImage).toHaveBeenCalledWith(null, "stories/console");
  });
});

describe("saveStory", () => {
  it("does nothing for a blank title", async () => {
    const from = db({});
    await saveStory(form({ title: " " }));
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

  it("approving publishes and enqueues social push + notify, and records the approval", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, approvals: () => approvalsBuilder });

    await decideStory(form({ id: "s1", decision: "approve" }));

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "story_live" }));
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "story", decision: "approved" }));
  });

  it("rejecting records the reason and notifies the member without publishing", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", member_id: "m1", status: "awaiting_approval" }));
    db({ stories: () => storiesBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideStory(form({ id: "s1", decision: "reject", reason: "Needs a photo" }));

    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "rejected", rejected_reason: "Needs a photo" });
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "story_rejected", reason: "Needs a photo" }));
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

describe("setStoryStatus", () => {
  it("does nothing without both an id and a status", async () => {
    await expect(setStoryStatus(form({ id: "s1" }))).resolves.toBeUndefined();
  });

  it("moves the card and redirects back to the board", async () => {
    db({ stories: () => queryBuilder(dbOk({ id: "s1", status: "draft", member_id: null })) });

    await expect(setStoryStatus(form({ id: "s1", status: "awaiting_approval" }))).rejects.toThrow("NEXT_REDIRECT:/console/stories");
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
