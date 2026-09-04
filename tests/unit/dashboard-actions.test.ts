import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelMembership, editEvent, editMachine, editStory, editVideo, markAllNotificationsRead, markNotificationRead, memberUploadEventImage,
  memberUploadImage, memberUploadVideoImage, proposeOwnArtworkSwap, renewAdvertBooking, requestVisibility,
  resubmitAdvert, savePrefs, submitAdvert, submitEvent, submitMachine, submitProfileEdit, submitStory, submitVideo,
  withdrawEvent, withdrawMachine, withdrawStory, withdrawVideo,
} from "@/app/dashboard/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { revalidatePath } from "next/cache";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireMember, uploadImage, removeMedia, notifyAdminFunnel, geocodeAddress } = vi.hoisted(() => ({
  requireMember: vi.fn(async (): Promise<CurrentUser & { memberId: string }> => ({
    userId: "u1", email: "member@acme.example", role: "member", memberId: "mem1", displayName: "Acme",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  removeMedia: vi.fn<(path: string | null | undefined) => Promise<void>>(async () => {}),
  notifyAdminFunnel: vi.fn(async () => {}),
  geocodeAddress: vi.fn<(address: string) => Promise<{ lat: number; lng: number } | null>>(async () => null),
}));
vi.mock("@/lib/auth", () => ({ requireMember }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia }));
vi.mock("@/lib/notify-admin", () => ({ notifyAdminFunnel }));
vi.mock("@/lib/adapters/geocode", () => ({ geocodeAddress }));

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

    expect(await memberUploadImage(form({}))).toContain("stories/mem1/abc.jpg");
    expect(uploadImage.mock.calls[0][1]).toBe("stories/mem1");

    await memberUploadVideoImage(form({}));
    expect(uploadImage.mock.calls[1][1]).toBe("videos/mem1");

    await memberUploadEventImage(form({}));
    expect(uploadImage.mock.calls[2][1]).toBe("events/mem1");
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
    const storiesBuilder = queryBuilder(dbOk({ id: "s1" }));
    const categoriesLinkBuilder = queryBuilder(dbOk(null));
    db({ stories: () => storiesBuilder, story_categories: () => categoriesLinkBuilder });

    await expect(submitStory(form({ title: "My Story!", category: "3" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");

    expect(storiesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      title: "My Story!", status: "awaiting_approval", source: "member", is_member_news: true, member_id: "mem1", submitted_by: "u1",
    }));
    expect(categoriesLinkBuilder.insert).toHaveBeenCalledWith({ story_id: "s1", category_id: 3 });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("attaches a cover_focus box only when focus_x was supplied", async () => {
    const storiesBuilder = queryBuilder(dbOk({ id: "s1" }));
    db({ stories: () => storiesBuilder });

    await expect(submitStory(form({ title: "t", focus_x: "0.5", focus_y: "0.25" })))
      .rejects.toThrow(/NEXT_REDIRECT/);

    expect(storiesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ cover_focus: { x: 0.5, y: 0.25, scale: 1 } }));
  });
});

describe("submitVideo", () => {
  it("does nothing without both a title and a url", async () => {
    const from = db({});
    await submitVideo(form({ title: "t", url: "" }));
    expect(from).not.toHaveBeenCalled();
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
    const membersBuilder = queryBuilder(dbOk({ name: "Acme", status: "draft", draft_submitted_at: null, social: null }));
    db({ members: () => membersBuilder });

    await expect(submitProfileEdit(form({}))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=page");

    expect(membersBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ draft_submitted_at: expect.any(String) }));
    expect(notifyAdminFunnel).toHaveBeenCalled();
  });

  it("does not re-notify Jas on a later edit of the same draft", async () => {
    db({ members: () => queryBuilder(dbOk({ name: "Acme", status: "draft", draft_submitted_at: "2026-01-01T00:00:00.000Z", social: null })) });

    await expect(submitProfileEdit(form({}))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=page");

    expect(notifyAdminFunnel).not.toHaveBeenCalled();
  });

  it("an active member's edit becomes a revision awaiting approval instead", async () => {
    const revisionsBuilder = queryBuilder(dbOk(null));
    db({ members: () => queryBuilder(dbOk({ name: "Acme", status: "active", draft_submitted_at: null, social: null })), member_revisions: () => revisionsBuilder });

    await expect(submitProfileEdit(form({ description: "New copy" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=profile");

    expect(revisionsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      member_id: "mem1", payload: expect.objectContaining({ description: "New copy" }),
    }));
  });

  it("rejects an invalid contact email before writing anything", async () => {
    const from = db({ members: () => queryBuilder(dbOk({ name: "Acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })) });

    await expect(submitProfileEdit(form({ contact_email: "nope" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/profile?error=Contact%20email%20is%20not%20a%20valid%20address.");
    expect(from).not.toHaveBeenCalledWith("member_revisions");
  });

  it("rejects a malformed phone number before writing anything", async () => {
    const from = db({ members: () => queryBuilder(dbOk({ name: "Acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })) });

    await expect(submitProfileEdit(form({ phone: "call me" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/profile\?error=Phone/);
    expect(from).not.toHaveBeenCalledWith("member_revisions");
  });

  it("re-geocodes only when the address actually changed, and keeps the old coordinates on a failed lookup", async () => {
    const revisionsBuilder = queryBuilder(dbOk(null));
    db({
      members: () => queryBuilder(dbOk({ name: "Acme", status: "active", draft_submitted_at: null, social: null, address: "1 Old Rd", lat: 52.1, lng: -1.1 })),
      member_revisions: () => revisionsBuilder,
    });
    geocodeAddress.mockResolvedValue(null); // lookup fails

    await expect(submitProfileEdit(form({ address: "2 New Rd" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(geocodeAddress).toHaveBeenCalledWith("2 New Rd");
    const [{ payload }] = (revisionsBuilder.insert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject({ lat: 52.1, lng: -1.1 }); // unchanged — the failed lookup didn't blank them
  });

  it("does not re-geocode when the address is unchanged", async () => {
    db({ members: () => queryBuilder(dbOk({ name: "Acme", status: "active", draft_submitted_at: null, social: null, address: "1 Old Rd", lat: 52.1, lng: -1.1 })) });

    await expect(submitProfileEdit(form({ address: "1 Old Rd" }))).rejects.toThrow(/NEXT_REDIRECT/);

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
    const storiesBuilder = queryBuilder(dbOk({ id: "s1", status: "rejected", member_id: "mem1" }));
    db({ stories: () => storiesBuilder });

    await expect(editStory(form({ id: "s1", title: "Fixed title" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      title: "Fixed title", status: "awaiting_approval", rejected_reason: null,
    }));
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

    await editVideo(form({ id: "v1", title: "t", url: "" }));

    expect(videosBuilder.update).not.toHaveBeenCalled();
  });

  it("editVideo resubmits with the new details", async () => {
    const videosBuilder = queryBuilder(dbOk({ id: "v1", status: "awaiting_approval", member_id: "mem1" }));
    db({ videos: () => videosBuilder });

    await expect(editVideo(form({ id: "v1", title: "t", url: "https://x" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=video");

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
    db({ advert_bookings: () => queryBuilder(dbOk({ id: "b1", advert_id: "ad1", product_id: null, advert: { member_id: "someone-else" } })) });

    await expect(renewAdvertBooking(form({ id: "b1" }))).resolves.toBeUndefined();
  });

  it("books a fresh run linked back to the one it renews", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", advert_id: "ad1", product_id: "p1", advert: { member_id: "mem1" } }));
    db({ advert_bookings: () => bookingsBuilder });

    await expect(renewAdvertBooking(form({ id: "b1", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=advert");

    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ advert_id: "ad1", renewed_from: "b1" }));
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
