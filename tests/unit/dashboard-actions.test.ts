import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelMembership, deleteStoryDraft, editEvent, previewStoryBody, editMachine, editStory, editVideo, markAllNotificationsRead, markNotificationRead, memberUploadEventImage,
  memberUploadImage, memberUploadVideoImage, proposeOwnArtworkSwap, renewAdvertBooking, requestVisibility,
  resubmitAdvert, savePrefs, submitAdvert, submitEvent, submitMachine, submitProfileEdit, submitStory, submitVideo,
  markProspectFollowUp, unmarkProspect,
  withdrawEvent, withdrawMachine, withdrawStory, withdrawVideo,
} from "@/app/dashboard/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { revalidatePath } from "next/cache";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireMember, uploadImage, removeMedia, notifyAdminFunnel, notifyConsole, geocodeAddress } = vi.hoisted(() => ({
  requireMember: vi.fn(async (): Promise<CurrentUser & { memberId: string }> => ({
    userId: "u1", email: "member@acme.example", role: "member", memberId: "mem1", displayName: "Acme",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  removeMedia: vi.fn<(path: string | null | undefined) => Promise<void>>(async () => {}),
  notifyAdminFunnel: vi.fn(async () => {}),
  // Every member submission now raises a console notification (fix-list 71).
  // Mocked rather than exercised here: what it writes is notify-admin's own
  // test's business — what matters to these tests is that the submission still
  // completes and still redirects.
  notifyConsole: vi.fn(async () => {}),
  geocodeAddress: vi.fn<(address: string) => Promise<{ lat: number; lng: number } | null>>(async () => null),
}));
vi.mock("@/lib/auth", () => ({ requireMember }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia }));
vi.mock("@/lib/notify-admin", () => ({ notifyAdminFunnel, notifyConsole }));
vi.mock("@/lib/adapters/geocode", () => ({ geocodeAddress }));

const { getLeadGenSource } = vi.hoisted(() => ({ getLeadGenSource: vi.fn() }));
vi.mock("@/lib/adapters/leadgen", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getLeadGenSource,
}));

// cancelMembership loads @/lib/membership dynamically; keep the module's other
// exports real so anything else in this graph (statuses, slugify) still works.
const { requestCancellation } = vi.hoisted(() => ({
  requestCancellation: vi.fn<(memberId: string) => Promise<{ ok: true } | { ok: false; error: string }>>(),
}));
vi.mock("@/lib/membership", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestCancellation,
}));

afterEach(() => {
  resetDbServerMocks();
  vi.mocked(revalidatePath).mockClear();
  requireMember.mockReset().mockResolvedValue({
    userId: "u1", email: "member@acme.example", role: "member", memberId: "mem1", displayName: "Acme",
  });
  uploadImage.mockReset().mockResolvedValue(null);
  removeMedia.mockReset().mockResolvedValue(undefined);
  notifyAdminFunnel.mockReset().mockResolvedValue(undefined);
  notifyConsole.mockReset().mockResolvedValue(undefined);
  geocodeAddress.mockReset().mockResolvedValue(null);
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

describe("member upload actions", () => {
  it("upload the file under the member's own namespace and return its public URL", async () => {
    uploadImage.mockResolvedValue("stories/mem1/abc.jpg");

    expect(await memberUploadImage(form({}))).toEqual({ url: expect.stringContaining("stories/mem1/abc.jpg") });
    expect(uploadImage.mock.calls[0][1]).toBe("stories/mem1");

    await memberUploadVideoImage(form({}));
    expect(uploadImage.mock.calls[1][1]).toBe("videos/mem1");

    await memberUploadEventImage(form({}));
    expect(uploadImage.mock.calls[2][1]).toBe("events/mem1");
  });

  // Jas 13/10 item 3: a refused photo used to throw, which Next turns into a
  // generic error in production and the editor turned into nothing at all.
  // The reason now comes back as a value the editor can show.
  it("return the refusal reason instead of throwing", async () => {
    uploadImage.mockRejectedValue(new Error("Image too large (8MB max)"));
    expect(await memberUploadImage(form({}))).toEqual({ error: "Image too large (8MB max)" });
    expect(await memberUploadVideoImage(form({}))).toEqual({ error: "Image too large (8MB max)" });
    expect(await memberUploadEventImage(form({}))).toEqual({ error: "Image too large (8MB max)" });
  });

  it("say so when no file arrived, rather than inserting a broken image", async () => {
    uploadImage.mockResolvedValue(null);
    expect(await memberUploadImage(form({}))).toEqual({ error: expect.stringMatching(/no image/i) });
  });
});

describe("submitStory", () => {
  it("does nothing for a blank title", async () => {
    const from = db({});
    await submitStory(form({ title: "  " }));
    expect(from).not.toHaveBeenCalled();
  });

  it("redirects with the upload error and never inserts, when the cover fails validation", async () => {
    uploadImage.mockRejectedValue(new Error("Image too large (8MB max)"));
    const from = db({});

    await expect(submitStory(form({ title: "My story" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/story/new?error=Image%20too%20large%20(8MB%20max)");
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts as a member submission awaiting approval, links the category, and redirects", async () => {
    uploadImage.mockResolvedValue("stories/mem1/cover.jpg");
    const storiesBuilder = queryBuilder(dbOk({ id: "s1" }));
    const categoriesLinkBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, story_categories: () => categoriesLinkBuilder });

    await expect(submitStory(form({ title: "My Story!", category: "3" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");

    expect(storiesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      title: "My Story!", status: "awaiting_approval", source: "member", is_member_news: true, member_id: "mem1", submitted_by: "u1",
      cover_path: "stories/mem1/cover.jpg",
    }));
    expect(categoriesLinkBuilder.insert).toHaveBeenCalledWith({ story_id: "s1", category_id: 3 });
    // Until fix-list 71 nothing here told the console at all: the only signal
    // was the aggregate "Needs you today" counter, which links to a list page
    // and never to the item. The payload carries the id so it can.
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({
      kind: "story_submitted", memberId: "mem1", payload: { story_id: "s1" },
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("attaches a cover_focus box only when focus_x was supplied", async () => {
    uploadImage.mockResolvedValue("stories/mem1/cover.jpg");
    const storiesBuilder = queryBuilder(dbOk({ id: "s1" }));
    db({ stories: () => storiesBuilder });

    await expect(submitStory(form({ title: "t", focus_x: "0.5", focus_y: "0.25" })))
      .rejects.toThrow(/NEXT_REDIRECT/);

    expect(storiesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ cover_focus: { x: 0.5, y: 0.25, scale: 1 } }));
  });

  it("requires a cover image — redirects without inserting when none was uploaded", async () => {
    const from = db({});

    await expect(submitStory(form({ title: "My story" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/story/new?error=A%20cover%20image%20is%20required.");
    expect(from).not.toHaveBeenCalled();
  });
});

describe("submitVideo", () => {
  it("redirects with a readable error without both a title and a url", async () => {
    const from = db({});
    await expect(submitVideo(form({ title: "t", url: "" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/video/new?error=A%20title%20and%20a%20YouTube%20link%20are%20both%20required.");
    expect(from).not.toHaveBeenCalled();
  });

  // USE-CASES gap 23: YouTube only. A Loom link used to save, pass approval
  // and then render as a card with no player.
  it("refuses a link that isn't YouTube, before any upload or write", async () => {
    const from = db({});
    await expect(submitVideo(form({ title: "t", url: "https://www.loom.com/share/abc" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/video\/new\?error=.*YouTube/);
    expect(from).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("inserts awaiting approval and redirects", async () => {
    const videosBuilder = queryBuilder(dbOk(null));
    db({ videos: () => videosBuilder });

    await expect(submitVideo(form({ title: "t", url: "https://youtube.com/watch?v=x" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=video");

    expect(videosBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", member_id: "mem1" }));
  });
});

describe("submitEvent", () => {
  it("does nothing for a blank title", async () => {
    const from = db({});
    await submitEvent(form({ title: "" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("stores a recognised type, and null for anything unrecognised", async () => {
    const eventsBuilder = queryBuilder(dbOk(null));
    db({ events: () => eventsBuilder });

    await expect(submitEvent(form({ title: "t", type: "webinar", starts_on: "2026-09-01" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(eventsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ type: "webinar" }));

    await expect(submitEvent(form({ title: "t", type: "bogus", starts_on: "2026-09-01" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(eventsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ type: null }));
  });
});

describe("submitProfileEdit", () => {
  it("draft member's first submission stamps draft_submitted_at and notifies Jas", async () => {
    const membersBuilder = queryBuilder(dbOk({ slug: "acme", status: "draft", draft_submitted_at: null, social: null, address: "", lat: null, lng: null }));
    db({ members: () => membersBuilder });

    await expect(submitProfileEdit(form({ name: "Acme" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=page");

    expect(membersBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ draft_submitted_at: expect.any(String) }));
    expect(notifyAdminFunnel).toHaveBeenCalled();
  });

  it("does not re-notify Jas on a later edit of the same draft", async () => {
    db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "draft", draft_submitted_at: "2026-01-01T00:00:00.000Z", social: null, address: "", lat: null, lng: null })) });

    await expect(submitProfileEdit(form({ name: "Acme" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=page");

    expect(notifyAdminFunnel).not.toHaveBeenCalled();
  });

  it("an active member's edit becomes a revision awaiting approval instead", async () => {
    const revisionsBuilder = queryBuilder(dbOk(null));
    db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })), member_revisions: () => revisionsBuilder });

    await expect(submitProfileEdit(form({ name: "Acme", description: "New copy" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=profile");

    expect(revisionsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      member_id: "mem1", payload: expect.objectContaining({ description: "New copy" }),
    }));
  });

  // GAPS A8.1: members pick their own membership types (up to 6).
  const withTypes = (fields: Record<string, string>, ids: number[]) => {
    const fd = form(fields);
    for (const id of ids) fd.append("membership_types", String(id));
    return fd;
  };

  it("an active member's membership types ride the revision, not the member row", async () => {
    const revisionsBuilder = queryBuilder(dbOk(null));
    const from = db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })), member_revisions: () => revisionsBuilder });

    await expect(submitProfileEdit(withTypes({ name: "Acme" }, [2, 5, 2]))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=profile");

    expect(revisionsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ membership_type_ids: [2, 5] }),
    }));
    // approval-gated: nothing touches the live types until Jas approves
    expect(from).not.toHaveBeenCalledWith("member_membership_types");
  });

  it("a draft member's membership types apply straight away", async () => {
    const typesBuilder = queryBuilder(dbOk(null));
    db({
      members: () => queryBuilder(dbOk({ slug: "acme", status: "draft", draft_submitted_at: "2026-01-01T00:00:00.000Z", social: null, address: "", lat: null, lng: null })),
      member_membership_types: () => typesBuilder,
    });

    await expect(submitProfileEdit(withTypes({ name: "Acme" }, [3]))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=page");

    expect(typesBuilder.insert).toHaveBeenCalledWith([{ member_id: "mem1", membership_type_id: 3 }]);
  });

  it("refuses more than six membership types before writing anything", async () => {
    const from = db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })) });

    await expect(submitProfileEdit(withTypes({ name: "Acme" }, [1, 2, 3, 4, 5, 6, 7])))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/profile?error=Choose%20up%20to%206%20membership%20types.");
    expect(from).not.toHaveBeenCalledWith("member_revisions");
    expect(from).not.toHaveBeenCalledWith("member_membership_types");
  });

  // Several industries per member, one primary (migration 20261012000001).
  const withIndustries = (fields: Record<string, string>, ids: number[]) => {
    const fd = form(fields);
    for (const id of ids) fd.append("industries", String(id));
    return fd;
  };

  it("an active member's industries ride the revision as industry_ids, primary included", async () => {
    const revisionsBuilder = queryBuilder(dbOk(null));
    const from = db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })), member_revisions: () => revisionsBuilder });

    // primary 9 not ticked — picking it as primary is enough
    await expect(submitProfileEdit(withIndustries({ name: "Acme", industry_id: "9" }, [2, 7]))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=profile");

    expect(revisionsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ industry_id: 9, industry_ids: [2, 7, 9] }),
    }));
    expect(from).not.toHaveBeenCalledWith("member_industries");
  });

  it("a draft member's industries apply straight away, a single tick becoming the primary", async () => {
    const membersBuilder = queryBuilder(dbOk({ slug: "acme", status: "draft", draft_submitted_at: "2026-01-01T00:00:00.000Z", social: null, address: "", lat: null, lng: null }));
    const industriesBuilder = queryBuilder(dbOk(null));
    db({ members: () => membersBuilder, member_industries: () => industriesBuilder });

    await expect(submitProfileEdit(withIndustries({ name: "Acme" }, [4]))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=page");

    expect(membersBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ industry_id: 4 }));
    expect(industriesBuilder.insert).toHaveBeenCalledWith([{ member_id: "mem1", industry_id: 4 }]);
  });

  it("refuses several industries with no primary before writing anything", async () => {
    const from = db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })) });

    await expect(submitProfileEdit(withIndustries({ name: "Acme" }, [2, 7])))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/profile\?error=Choose%20which/);
    expect(from).not.toHaveBeenCalledWith("member_revisions");
    expect(from).not.toHaveBeenCalledWith("member_industries");
  });

  // GAPS A1.12: a live page's edit notifies the console like every other submission.
  it("an active member's edit notifies the console, linking to their record", async () => {
    db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })), member_revisions: () => queryBuilder(dbOk(null)) });

    await expect(submitProfileEdit(form({ name: "Acme" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=profile");

    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({ kind: "page_edit_submitted", memberId: "mem1", payload: { member_id: "mem1" } }));
  });

  it("a draft's save is page_submitted, not a page edit", async () => {
    db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "draft", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })) });

    await expect(submitProfileEdit(form({ name: "Acme" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=page");

    expect(notifyConsole).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "page_edit_submitted" }));
  });

  it("rejects an invalid contact email before writing anything", async () => {
    const from = db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })) });

    await expect(submitProfileEdit(form({ name: "Acme", contact_email: "nope" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/profile?error=Contact%20email%20is%20not%20a%20valid%20address.");
    expect(from).not.toHaveBeenCalledWith("member_revisions");
  });

  it("rejects a malformed phone number before writing anything", async () => {
    const from = db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })) });

    await expect(submitProfileEdit(form({ name: "Acme", phone: "call me" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/profile\?error=Phone/);
    expect(from).not.toHaveBeenCalledWith("member_revisions");
  });

  it("re-geocodes only when the address actually changed, and keeps the old coordinates on a failed lookup", async () => {
    const revisionsBuilder = queryBuilder(dbOk(null));
    db({
      members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "1 Old Rd", lat: 52.1, lng: -1.1 })),
      member_revisions: () => revisionsBuilder,
    });
    geocodeAddress.mockResolvedValue(null); // lookup fails

    await expect(submitProfileEdit(form({ name: "Acme", address: "2 New Rd" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(geocodeAddress).toHaveBeenCalledWith("2 New Rd");
    const [{ payload }] = (revisionsBuilder.insert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject({ lat: 52.1, lng: -1.1 }); // unchanged — the failed lookup didn't blank them
  });

  it("does not re-geocode when the address is unchanged", async () => {
    db({ members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "1 Old Rd", lat: 52.1, lng: -1.1 })) });

    await expect(submitProfileEdit(form({ name: "Acme", address: "1 Old Rd" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(geocodeAddress).not.toHaveBeenCalled();
  });
});

describe("cancelMembership", () => {
  it("requests cancellation for the signed-in member and confirms", async () => {
    requestCancellation.mockResolvedValue({ ok: true });

    await expect(cancelMembership()).rejects.toThrow("NEXT_REDIRECT:/dashboard/settings/billing?cancelled=1");

    expect(requestCancellation).toHaveBeenCalledWith("mem1");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/settings/billing");
  });

  it("surfaces a failed cancellation via the cerror param", async () => {
    requestCancellation.mockResolvedValue({ ok: false, error: "No active subscription on record — contact SMI to cancel." });

    await expect(cancelMembership()).rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/settings\/billing\?cerror=No%20active%20subscription/);
  });
});

describe("withdrawStory / editStory", () => {
  it("withdrawStory does nothing for a story that isn't the member's own", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "awaiting_approval", member_id: "someone-else" }));
    db({ stories: () => storiesBuilder });

    await expect(withdrawStory(form({ id: "s1" }))).resolves.toBeUndefined();
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("withdrawStory does nothing once a story is past the editable states", async () => {
    db({ stories: () => queryBuilder(dbOk({ id: "s1", status: "published", member_id: "mem1" })) });
    await expect(withdrawStory(form({ id: "s1" }))).resolves.toBeUndefined();
  });

  it("withdrawStory marks an owned, pending story withdrawn", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "rejected", member_id: "mem1" }));
    db({ stories: () => storiesBuilder });

    await expect(withdrawStory(form({ id: "s1" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "withdrawn" });
  });

  it("editStory does nothing for a story that isn't owned and pending", async () => {
    const from = db({ stories: () => queryBuilder(dbOk(null)) });
    await expect(editStory(form({ id: "s1", title: "New title" }))).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalledWith("story_categories");
  });

  it("editStory resubmits, clearing the prior rejection reason", async () => {
    // cover_path already on file — a resubmit isn't forced to re-upload one
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "rejected", member_id: "mem1", cover_path: "stories/mem1/existing.jpg" }));
    db({ stories: () => storiesBuilder });

    await expect(editStory(form({ id: "s1", title: "Fixed title" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      title: "Fixed title", status: "awaiting_approval", rejected_reason: null,
    }));
  });

  it("editStory requires a cover on a legacy story that has neither an existing one nor a new upload", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "rejected", member_id: "mem1", cover_path: null }));
    db({ stories: () => storiesBuilder });

    await expect(editStory(form({ id: "s1", title: "Fixed title" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/story/s1/edit?error=A%20cover%20image%20is%20required.");
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });
});

// Jas 13/10: members can save a story as a private draft, preview it, and
// submit it later. A draft is theirs alone — and an admin's draft that merely
// names them must never become theirs.
describe("member story drafts", () => {
  it("Save draft inserts a private draft without a cover and tells nobody", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1" }));
    db({ stories: () => storiesBuilder });

    await expect(submitStory(form({ title: "Work in progress", intent: "draft" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/story/s1/edit?saved=draft");

    expect(storiesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      title: "Work in progress", status: "draft", member_draft: true, source: "member", member_id: "mem1", cover_path: null,
    }));
    expect(notifyConsole).not.toHaveBeenCalled();
  });

  it("a member's own story features them: their row goes into story_members", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1" }));
    const tagsBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, story_members: () => tagsBuilder });
    await expect(submitStory(form({ title: "Mine", intent: "draft" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(tagsBuilder.insert).toHaveBeenCalledWith([{ story_id: "s1", member_id: "mem1" }]);
  });

  it("Save draft still needs a title, and says so (the button skips native validation)", async () => {
    const from = db({});
    await expect(submitStory(form({ title: " ", intent: "draft" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/story\/new\?error=Give/);
    expect(from).not.toHaveBeenCalled();
  });

  it("a plain submit is unchanged: awaiting approval, not a draft", async () => {
    uploadImage.mockResolvedValue("stories/mem1/cover.jpg");
    const storiesBuilder = queryBuilder(dbOk({ id: "s1" }));
    db({ stories: () => storiesBuilder });
    await expect(submitStory(form({ title: "Ready" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");
    expect(storiesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", member_draft: false }));
  });

  it("editing a draft with Save draft keeps it a draft", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "draft", member_id: "mem1", member_draft: true, cover_path: null }));
    db({ stories: () => storiesBuilder });

    await expect(editStory(form({ id: "s1", title: "Still drafting", intent: "draft" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/story/s1/edit?saved=draft");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", member_draft: true }));
    expect(notifyConsole).not.toHaveBeenCalled();
  });

  it("submitting a draft needs a cover by then", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "draft", member_id: "mem1", member_draft: true, cover_path: null }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Done" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/story/s1/edit?error=A%20cover%20image%20is%20required.");
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("submitting a draft hands it to the editor as a fresh submission", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "draft", member_id: "mem1", member_draft: true, cover_path: "stories/c.jpg" }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Done" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", member_draft: false }));
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/^Submitted a story/) }));
  });

  it("Save draft can't pull an already-submitted story back out of the editor's queue", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "awaiting_approval", member_id: "mem1", member_draft: false, cover_path: "stories/c.jpg" }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "x", intent: "draft" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", member_draft: false }));
  });

  it("an admin's draft that names the member is not the member's to edit", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "draft", member_id: "mem1", member_draft: false, cover_path: "c.jpg" }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Hijack", intent: "draft" }))).resolves.toBeUndefined();
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("deleteStoryDraft deletes only the member's own draft, and its cover", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "draft", member_id: "mem1", member_draft: true, cover_path: "stories/c.jpg" }));
    db({ stories: () => storiesBuilder });
    await expect(deleteStoryDraft(form({ id: "s1" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard/submissions?deleted=draft");
    expect(storiesBuilder.delete).toHaveBeenCalled();
    expect(removeMedia).toHaveBeenCalledWith("stories/c.jpg");
  });

  it.each([
    ["a submitted story", { status: "awaiting_approval", member_id: "mem1", member_draft: false }],
    ["someone else's draft", { status: "draft", member_id: "other", member_draft: true }],
    ["an admin's draft naming the member", { status: "draft", member_id: "mem1", member_draft: false }],
  ])("deleteStoryDraft refuses %s", async (_label, row) => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", cover_path: null, ...row }));
    db({ stories: () => storiesBuilder });
    await expect(deleteStoryDraft(form({ id: "s1" }))).resolves.toBeUndefined();
    expect(storiesBuilder.delete).not.toHaveBeenCalled();
  });
});

describe("previewStoryBody", () => {
  it("cleans the body exactly as the published page will", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
    db({ members: () => queryBuilder(dbOk({ id: "mem1", name: "Acme", website: null, status: "active", archived_at: null })) });
    const out = await previewStoryBody(`<p>Hi</p><script>alert(1)</script><img src="https://evil.example/x.jpg">`);
    expect(out).toBe("<p>Hi</p>");
  });

  it("closes with the member's own website line, as the published page will", async () => {
    db({ members: () => queryBuilder(dbOk({ id: "mem1", name: "Acme", website: "https://acme.example", status: "active", archived_at: null })) });
    expect(await previewStoryBody("<p>Hi</p>")).toBe(
      `<p>Hi</p><p data-company-link=""><a href="/go/mem1?kind=website" target="_blank" rel="noopener">Acme</a></p>`,
    );
  });

  it("is member-only", async () => {
    requireMember.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login?next=/dashboard"));
    await expect(previewStoryBody("<p>x</p>")).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe("withdrawVideo / editVideo", () => {
  it("withdrawVideo requires ownership of a still-pending video", async () => {
    const from = db({ videos: () => queryBuilder(dbOk(null)) });
    await expect(withdrawVideo(form({ id: "v1" }))).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalledWith("videos", expect.anything());
  });

  it("editVideo requires both a title and a url on resubmission", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "awaiting_approval", member_id: "mem1" }));
    db({ videos: () => videosBuilder });

    await expect(editVideo(form({ id: "v1", title: "t", url: "" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/video\/v1\/edit\?error=/);

    expect(videosBuilder.update).not.toHaveBeenCalled();
  });

  it("editVideo refuses a link that isn't YouTube", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "awaiting_approval", member_id: "mem1" }));
    db({ videos: () => videosBuilder });

    await expect(editVideo(form({ id: "v1", title: "t", url: "https://vimeo.com/123" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/video\/v1\/edit\?error=.*YouTube/);

    expect(videosBuilder.update).not.toHaveBeenCalled();
  });

  it("editVideo resubmits with the new details", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "awaiting_approval", member_id: "mem1" }));
    db({ videos: () => videosBuilder });

    await expect(editVideo(form({ id: "v1", title: "t", url: "https://youtu.be/abc" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=video");

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", rejected_reason: null }));
  });
});

describe("withdrawEvent / editEvent", () => {
  it("withdrawEvent marks an owned, pending event withdrawn", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1", status: "awaiting_approval", member_id: "mem1" }));
    db({ events: () => eventsBuilder });

    await expect(withdrawEvent(form({ id: "e1" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(eventsBuilder.update).toHaveBeenCalledWith({ status: "withdrawn" });
  });

  it("editEvent stores a recognised type and resubmits", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1", status: "rejected", member_id: "mem1" }));
    db({ events: () => eventsBuilder });

    await expect(editEvent(form({ id: "e1", title: "t", type: "webinar" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=event");

    expect(eventsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ type: "webinar", status: "awaiting_approval" }));
  });

  it("editEvent does nothing for a blank title", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1", status: "rejected", member_id: "mem1" }));
    db({ events: () => eventsBuilder });

    await editEvent(form({ id: "e1", title: "  " }));

    expect(eventsBuilder.update).not.toHaveBeenCalled();
  });
});

describe("withdrawMachine / editMachine", () => {
  it("withdrawMachine marks an owned, pending listing withdrawn", async () => {
    const machinesBuilder = queryBuilder(dbOk({ id: "mc1", status: "awaiting_approval", member_id: "mem1" }));
    db({ featured_machines: () => machinesBuilder });

    await expect(withdrawMachine(form({ id: "mc1" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(machinesBuilder.update).toHaveBeenCalledWith({ status: "withdrawn" });
  });

  it("editMachine requires a name", async () => {
    const machinesBuilder = queryBuilder(dbOk({ id: "mc1", status: "rejected", member_id: "mem1" }));
    db({ featured_machines: () => machinesBuilder });

    await editMachine(form({ id: "mc1", name: " " }));

    expect(machinesBuilder.update).not.toHaveBeenCalled();
  });

  it("editMachine resubmits with the new details", async () => {
    const machinesBuilder = queryBuilder(dbOk({ id: "mc1", status: "rejected", member_id: "mem1" }));
    db({ featured_machines: () => machinesBuilder });

    await expect(editMachine(form({ id: "mc1", name: "Press brake" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=machine");

    expect(machinesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ name: "Press brake", status: "awaiting_approval", rejected_reason: null }));
  });

  it("editMachine refuses a video link that isn't YouTube (GAPS A9.4)", async () => {
    const machinesBuilder = queryBuilder(dbOk({ id: "mc1", status: "rejected", member_id: "mem1" }));
    db({ featured_machines: () => machinesBuilder });

    await expect(editMachine(form({ id: "mc1", name: "Press brake", video_url: "https://www.loom.com/share/x" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/equipment\/mc1\/edit\?error=.*YouTube/);
    expect(machinesBuilder.update).not.toHaveBeenCalled();
  });
});

describe("markNotificationRead / markAllNotificationsRead", () => {
  it("marks a single notification read, scoped to this member and only if unread", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ notifications: () => builder });

    await markNotificationRead(form({ id: "n1" }));

    expect(builder.update).toHaveBeenCalledWith({ read_at: expect.any(String) });
    expect(builder.eq).toHaveBeenCalledWith("id", "n1");
    expect(builder.eq).toHaveBeenCalledWith("member_id", "mem1");
    expect(builder.is).toHaveBeenCalledWith("read_at", null);
  });

  it("marks every unread notification for this member read", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ notifications: () => builder });

    await markAllNotificationsRead();

    expect(builder.eq).toHaveBeenCalledWith("member_id", "mem1");
    expect(builder.is).toHaveBeenCalledWith("read_at", null);
  });
});

describe("submitMachine", () => {
  it("does nothing for a blank name", async () => {
    const from = db({});
    await submitMachine(form({ name: " " }));
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts awaiting approval", async () => {
    const machinesBuilder = queryBuilder(dbOk(null));
    db({ featured_machines: () => machinesBuilder });

    await expect(submitMachine(form({ name: "Laser cutter" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(machinesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ name: "Laser cutter", status: "awaiting_approval" }));
  });

  // GAPS A9.4: members can attach a video of the machine running.
  it("stores an optional YouTube video with the listing", async () => {
    const machinesBuilder = queryBuilder(dbOk(null));
    db({ featured_machines: () => machinesBuilder });

    await expect(submitMachine(form({ name: "Laser cutter", video_url: "https://www.youtube.com/watch?v=abc123" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(machinesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ video_url: "https://www.youtube.com/watch?v=abc123" }));
  });

  it("refuses a non-YouTube video link before uploading the photo", async () => {
    const from = db({});
    await expect(submitMachine(form({ name: "Laser cutter", video_url: "https://vimeo.com/1" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/equipment\/new\?error=.*YouTube/);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("requestVisibility / savePrefs", () => {
  it("requestVisibility records the product and optional message", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ visibility_requests: () => builder });

    await expect(requestVisibility(form({ product: "featured" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=buy");
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ member_id: "mem1", product: "featured" }));
  });

  it("savePrefs defaults frequencies when not given", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ notification_prefs: () => builder });

    await expect(savePrefs(form({}))).rejects.toThrow("NEXT_REDIRECT:/dashboard/settings?saved=1");
    expect(builder.upsert).toHaveBeenCalledWith({ member_id: "mem1", stats_frequency: "quarterly", leads_frequency: "weekly" });
  });
});

describe("submitAdvert", () => {
  const advertForm = (over: Record<string, string> = {}) =>
    form({ name: "Spring campaign", format: "banner", starts_on: "2026-09-01", ends_on: "2026-09-30", ...over });

  it("does nothing when a required field is missing", async () => {
    const from = db({});
    await submitAdvert(form({ name: "", format: "banner", starts_on: "2026-09-01", ends_on: "2026-09-30" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("requires both artwork images", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce(null);
    db({});

    await expect(submitAdvert(advertForm())).rejects.toThrow(/Both%20a%20desktop%20and%20a%20mobile%20image%20are%20required/);
  });

  it("cleans up uploaded artwork and reports the error when the advert insert fails", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce("panels/mem1/m.jpg");
    db({ adverts: () => queryBuilder(dbError("write failed")) });

    await expect(submitAdvert(advertForm())).rejects.toThrow(/write%20failed/);
    expect(removeMedia).toHaveBeenCalledWith("panels/mem1/d.jpg");
    expect(removeMedia).toHaveBeenCalledWith("panels/mem1/m.jpg");
  });

  it("cleans up the advert row and artwork, with a friendlier message, when the booking's dates are invalid", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce("panels/mem1/m.jpg");
    const advertsBuilder = queryBuilder(dbOk({ id: "ad1" }));
    const bookingsBuilder = queryBuilder(dbError("ends_on must be on or after starts_on"));
    db({ adverts: () => advertsBuilder, advert_bookings: () => bookingsBuilder });

    await expect(submitAdvert(advertForm())).rejects.toThrow(/must%20end%20on%20or%20after%20its%20start%20date/);

    expect(advertsBuilder.delete).toHaveBeenCalled();
    expect(removeMedia).toHaveBeenCalledTimes(2);
  });

  it("creates the advert and its booking, then redirects on success", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce("panels/mem1/m.jpg");
    const advertsBuilder = queryBuilder(dbOk({ id: "ad1" }));
    const bookingsBuilder = queryBuilder(dbOk(null));
    db({ adverts: () => advertsBuilder, advert_bookings: () => bookingsBuilder });

    await expect(submitAdvert(advertForm())).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=advert");

    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ advert_id: "ad1", status: "awaiting_approval" }));
  });
});

describe("resubmitAdvert", () => {
  it("does nothing for a booking that isn't the caller's own", async () => {
    db({ advert_bookings: () => queryBuilder(dbOk({ id: "b1", status: "draft", advert: { id: "ad1", member_id: "someone-else" } })) });

    await expect(resubmitAdvert(form({ id: "b1" }))).resolves.toBeUndefined();
  });

  it("does nothing once a booking is past the editable draft/review_required states", async () => {
    db({ advert_bookings: () => queryBuilder(dbOk({ id: "b1", status: "live", advert: { id: "ad1", member_id: "mem1" } })) });

    await expect(resubmitAdvert(form({ id: "b1" }))).resolves.toBeUndefined();
  });

  it("resends for approval, clearing the prior review reason", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", status: "review_required", advert: { id: "ad1", member_id: "mem1" } }));
    db({ advert_bookings: () => bookingsBuilder, adverts: () => queryBuilder(dbOk(null)) });

    await expect(resubmitAdvert(form({ id: "b1", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=advert");

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", review_reason: null }));
  });
});

describe("renewAdvertBooking", () => {
  it("does nothing for a run that isn't the caller's own advert", async () => {
    db({ advert_bookings: () => queryBuilder(dbOk({ id: "b1", advert_id: "ad1", price_pennies: null, advert: { member_id: "someone-else" } })) });

    await expect(renewAdvertBooking(form({ id: "b1" }))).resolves.toBeUndefined();
  });

  it("books a fresh run linked back to the one it renews", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", advert_id: "ad1", price_pennies: 65000, advert: { member_id: "mem1" } }));
    db({ advert_bookings: () => bookingsBuilder });

    await expect(renewAdvertBooking(form({ id: "b1", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=advert");

    // last run's price carries over for the admin to confirm on approval (fix-list 77)
    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ advert_id: "ad1", renewed_from: "b1", price_pennies: 65000 }));
  });
});

describe("proposeOwnArtworkSwap", () => {
  it("does nothing for an advert that isn't the caller's own", async () => {
    db({ adverts: () => queryBuilder(dbOk({ id: "ad1", member_id: "someone-else" })) });

    await expect(proposeOwnArtworkSwap(form({ advert_id: "ad1" }))).resolves.toBeUndefined();
  });

  it("reports a friendlier message when a swap is already pending", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce("panels/mem1/m.jpg");
    db({
      adverts: () => queryBuilder(dbOk({ id: "ad1", member_id: "mem1" })),
      advert_artwork_proposals: () => queryBuilder(dbError("duplicate key value violates unique constraint \"advert_artwork_proposals_one_pending\"")),
    });

    await expect(proposeOwnArtworkSwap(form({ advert_id: "ad1", booking_id: "b1" })))
      .rejects.toThrow(/already%20have%20a%20swap%20awaiting%20a%20decision/);
  });

  it("submits the proposal pending review", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce("panels/mem1/m.jpg");
    const proposalsBuilder = queryBuilder(dbOk(null));
    db({ adverts: () => queryBuilder(dbOk({ id: "ad1", member_id: "mem1" })), advert_artwork_proposals: () => proposalsBuilder });

    await expect(proposeOwnArtworkSwap(form({ advert_id: "ad1", booking_id: "b1" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/advert/b1?submitted=swap");

    expect(proposalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", advert_id: "ad1" }));
  });
});

describe("markProspectFollowUp — ownership", () => {
  /** The adapter's mock, with a known window for this member. */
  function withSource(refs: string[]) {
    const mark = vi.fn(async () => {});
    vi.mocked(getLeadGenSource).mockReturnValue({
      search: vi.fn(async () => refs.map((ref) => ({
        ref, name: "N", company: "C", email: null, phone: null,
        linkedinUrl: ref, companyType: null, location: null, distanceMiles: 1,
      }))),
      mark,
    });
    return mark;
  }

  it("marks a prospect the member can actually see", async () => {
    const mark = withSource(["https://www.linkedin.com/company/acme"]);

    await markProspectFollowUp(form({ ref: "https://www.linkedin.com/company/acme" }));

    expect(mark).toHaveBeenCalledWith("https://www.linkedin.com/company/acme", "follow_up", { memberId: "mem1" });
  });

  it("ignores a ref outside this member's own results", async () => {
    // Stands in for assertOwnsRow: there is no row of ours to check, so the
    // adapter's own scoped result set is the ownership boundary. Without this a
    // member could mark a competitor's prospect once the source is live.
    const mark = withSource(["https://www.linkedin.com/company/acme"]);

    await markProspectFollowUp(form({ ref: "https://www.linkedin.com/company/someone-elses" }));

    expect(mark).not.toHaveBeenCalled();
  });

  it("takes member_id from the session, never the form", async () => {
    const mark = withSource(["https://www.linkedin.com/company/acme"]);

    await markProspectFollowUp(form({ ref: "https://www.linkedin.com/company/acme", member_id: "mem-someone-else" }));

    expect(mark).toHaveBeenCalledWith(expect.any(String), "follow_up", { memberId: "mem1" });
  });

  it("cannot be talked into an admin-only action by a crafted POST", async () => {
    // call/email/sequence are A29 capabilities. The action is hard-coded, so a
    // form field naming one is simply ignored.
    const mark = withSource(["https://www.linkedin.com/company/acme"]);

    await markProspectFollowUp(form({ ref: "https://www.linkedin.com/company/acme", action: "sequence" }));

    expect(mark).toHaveBeenCalledWith(expect.any(String), "follow_up", expect.anything());
  });
});

describe("unmarkProspect", () => {
  it("deletes only a mark belonging to this member", async () => {
    const marks = queryBuilder(dbOk({ id: "mark1", member_id: "mem1" }));
    db({ prospect_marks: () => marks });

    await unmarkProspect(form({ id: "mark1" }));

    expect(marks.delete).toHaveBeenCalled();
  });

  it("leaves another member's mark alone", async () => {
    const marks = queryBuilder(dbOk({ id: "mark1", member_id: "mem-other" }));
    db({ prospect_marks: () => marks });

    await unmarkProspect(form({ id: "mark1" }));

    expect(marks.delete).not.toHaveBeenCalled();
  });
});
