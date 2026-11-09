import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteStoryDraft, editEvent, previewStoryBody, editMachine, editStory, editVideo, markAllNotificationsRead, markNotificationRead, memberUploadEventImage,
  memberUploadImage, memberUploadVideoImage, proposeOwnArtworkSwap, renewAdvertBooking, requestVisibility,
  resubmitAdvert, savePrefs, submitAdvert, submitEvent, submitMachine, submitProfileEdit, submitStory, submitVideo,
  markProspectFollowUp, unmarkProspect,
  withdrawEvent, withdrawMachine, withdrawStory, withdrawVideo,
} from "@/app/dashboard/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { revalidatePath } from "next/cache";
import type { CurrentUser, MemberView } from "@/lib/auth";
import { IMAGE_TOO_LARGE, UPLOAD_EXPIRED, UploadRejectedError } from "@/lib/upload-limits";
import { MEMBER_CHANGED_ERROR, STORY_CHANGED_ERROR } from "@/lib/member-content";
import { featuredMonths } from "@/lib/featured-availability";
import { FEATURED_SLOTS } from "@/lib/pricing";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireMember, requireMemberView, uploadImage, removeMedia, removeMediaIfUnused, notifyAdminFunnel, notifyConsole, geocodeAddress, logError } = vi.hoisted(() => ({
  requireMember: vi.fn(async (): Promise<CurrentUser & { memberId: string }> => ({
    userId: "u1", email: "member@acme.example", role: "member", memberId: "mem1", displayName: "Acme",
  })),
  // previewStoryBody only: the one read-only member action an admin viewing as
  // the member may call (view-as-wiring.test.ts).
  requireMemberView: vi.fn(async (): Promise<MemberView> => ({ memberId: "mem1", email: "member@acme.example", viewingAs: null })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  removeMedia: vi.fn<(path: string | null | undefined) => Promise<void>>(async () => {}),
  removeMediaIfUnused: vi.fn<(paths: readonly (string | null | undefined)[]) => Promise<void>>(async () => {}),
  logError: vi.fn(),
  notifyAdminFunnel: vi.fn(async () => {}),
  // Every member submission now raises a console notification (fix-list 71).
  // Mocked rather than exercised here: what it writes is notify-admin's own
  // test's business — what matters to these tests is that the submission still
  // completes and still redirects.
  notifyConsole: vi.fn(async () => {}),
  geocodeAddress: vi.fn<(address: string) => Promise<{ lat: number; lng: number } | null>>(async () => null),
}));
vi.mock("@/lib/auth", () => ({ requireMember, requireMemberView }));
// The security log has its own tests (audit.test.ts); here it only must not get in the way.
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia, removeMediaIfUnused }));
vi.mock("@/lib/log", () => ({ logError }));
vi.mock("@/lib/notify-admin", () => ({ notifyAdminFunnel, notifyConsole }));
vi.mock("@/lib/adapters/geocode", () => ({ geocodeAddress }));

// The member Leads flag (/console/features). On by default here so the
// prospect tests below exercise the actions; the "switched off" cases flip it.
const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled }));

const { getLeadGenSource } = vi.hoisted(() => ({ getLeadGenSource: vi.fn() }));
vi.mock("@/lib/adapters/leadgen", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getLeadGenSource,
}));

afterEach(() => {
  resetDbServerMocks();
  vi.mocked(revalidatePath).mockClear();
  isFeatureEnabled.mockReset().mockResolvedValue(true);
  requireMember.mockReset().mockResolvedValue({
    userId: "u1", email: "member@acme.example", role: "member", memberId: "mem1", displayName: "Acme",
  });
  requireMemberView.mockReset().mockResolvedValue({ memberId: "mem1", email: "member@acme.example", viewingAs: null });
  uploadImage.mockReset().mockResolvedValue(null);
  removeMedia.mockReset().mockResolvedValue(undefined);
  removeMediaIfUnused.mockReset().mockResolvedValue(undefined);
  logError.mockReset();
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

const callsOf = (method: unknown) => (method as { mock: { calls: unknown[][] } }).mock.calls;

/**
 * A `stories` table that answers reads with `row` and, once anything has been
 * written, answers with `write` — the rows a conditional update/delete hands
 * back (`.select()` after the write). An empty array is the stale case: the
 * row was no longer in the state the write was conditional on.
 */
function storyTable(row: Record<string, unknown> | null, write: DbResult = dbOk([{ id: "s1", cover_path: null, body: "" }])) {
  const builder: ReturnType<typeof queryBuilder> = queryBuilder<unknown>((): DbResult =>
    callsOf(builder.update).length || callsOf(builder.delete).length ? write : dbOk(row));
  return builder;
}

/** A member-written story row, the only kind a member may change. */
const memberStory = (over: Record<string, unknown> = {}) => ({
  id: "s1", status: "awaiting_approval", member_id: "mem1", member_draft: false, source: "member",
  cover_path: "stories/existing.jpg", updated_at: "2026-10-15T09:00:00.123456+00:00", ...over,
});

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
    uploadImage.mockRejectedValue(new UploadRejectedError(IMAGE_TOO_LARGE));
    expect(await memberUploadImage(form({}))).toEqual({ error: "Image too large (8MB max)" });
    expect(await memberUploadVideoImage(form({}))).toEqual({ error: "Image too large (8MB max)" });
    expect(await memberUploadEventImage(form({}))).toEqual({ error: "Image too large (8MB max)" });
  });

  // Review finding 16 Oct: the editor showed storage/Postgres error text verbatim.
  it("never hand a storage error's own text to the browser — it is logged, and a plain line shown", async () => {
    const leak = new Error('new row violates row-level security policy for table "objects" (bucket media)');
    uploadImage.mockRejectedValue(leak);
    const result = await memberUploadImage(form({}));
    expect(result).toEqual({ error: expect.stringMatching(/didn't go through/) });
    expect(JSON.stringify(result)).not.toMatch(/row-level|bucket|objects/);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ error: leak }));
  });

  it("say so when no file arrived, rather than inserting a broken image", async () => {
    uploadImage.mockResolvedValue(null);
    expect(await memberUploadImage(form({}))).toEqual({ error: expect.stringMatching(/no image/i) });
  });
});

/**
 * Direct uploads (lib/staged-upload): a form posts the path its file was
 * staged at instead of the bytes. Whose path it may be comes from the session
 * — here mem1 — never from the request.
 */
describe("staged uploads", () => {
  const NAME = "3d6f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b.png";
  const own = `members/mem1/${NAME}`;
  const theirs = `members/mem2/${NAME}`;

  /** A staging bucket holding one small PNG, at whatever path is asked for. */
  function stagingHolds(tables: Record<string, () => ReturnType<typeof queryBuilder>> = {}) {
    const bucket = {
      info: vi.fn(async () => dbOk({ size: 3, contentType: "image/png", metadata: { name: "plant.png" } })),
      download: vi.fn(async () => dbOk(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }))),
      remove: vi.fn(async () => dbOk([])),
    };
    const from = fromByTable(tables, () => queryBuilder(dbOk(null)));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from, storage: { from: vi.fn(() => bucket) } })));
    return { bucket, from };
  }

  it("the editor's image action claims the member's own staged file and stores it as before", async () => {
    const { bucket } = stagingHolds();
    uploadImage.mockResolvedValue("stories/mem1/abc.png");

    expect(await memberUploadImage(form({ file: own }))).toEqual({ url: expect.stringContaining("stories/mem1/abc.png") });
    const [file, prefix] = uploadImage.mock.calls[0];
    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe("plant.png");
    expect(prefix).toBe("stories/mem1");
    expect(bucket.remove).toHaveBeenCalledWith([own]);
  });

  it("…and refuses another member's, without reading it", async () => {
    const { bucket } = stagingHolds();
    expect(await memberUploadImage(form({ file: theirs }))).toEqual({ error: UPLOAD_EXPIRED });
    expect(await memberUploadVideoImage(form({ file: theirs }))).toEqual({ error: UPLOAD_EXPIRED });
    expect(await memberUploadEventImage(form({ file: theirs }))).toEqual({ error: UPLOAD_EXPIRED });
    expect(bucket.info).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("a story cover staged by someone else is refused on the form, and nothing is saved", async () => {
    const { from } = stagingHolds();
    await expect(submitStory(form({ title: "Mine", cover: theirs })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/story/new?error=${encodeURIComponent(UPLOAD_EXPIRED)}`);
    expect(from).not.toHaveBeenCalledWith("stories");
  });

  it("a story cover staged by this member goes through uploadImage", async () => {
    stagingHolds({ stories: () => queryBuilder(dbOk({ id: "s1" })) });
    uploadImage.mockResolvedValue("stories/cover.png");
    await expect(submitStory(form({ title: "Mine", cover: own }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");
    expect(uploadImage.mock.calls[0][0]).toBeInstanceOf(File);
  });

  // These three used to throw into the error boundary on any upload failure;
  // an expired staged file is a new way to fail, so each now says it on the form.
  it.each([
    ["submitVideo", () => submitVideo(form({ title: "t", url: "https://youtube.com/watch?v=dQw4w9WgXcQ", thumbnail: theirs })), "/dashboard/video/new"],
    ["submitEvent", () => submitEvent(form({ title: "t", starts_on: "2026-09-01", cover: theirs })), "/dashboard/event/new"],
    ["submitMachine", () => submitMachine(form({ name: "Press", image: theirs })), "/dashboard/equipment/new"],
  ])("%s says an upload problem on its form rather than crashing", async (_name, run, page) => {
    stagingHolds();
    await expect(run()).rejects.toThrow(`NEXT_REDIRECT:${page}?error=${encodeURIComponent(UPLOAD_EXPIRED)}`);
  });

  it("the company page stores a staged logo under the member's prefix, and refuses a cover staged by someone else", async () => {
    const memberRow = () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: {}, address: null, lat: null, lng: null }));
    stagingHolds({ members: memberRow });
    await expect(submitProfileEdit(form({ logo: own, hero: theirs })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/profile?error=${encodeURIComponent(UPLOAD_EXPIRED)}`);

    uploadImage.mockClear();
    stagingHolds({ members: memberRow });
    await submitProfileEdit(form({ logo: own })).catch(() => {}); // the rest of the save is tested elsewhere
    const logo = uploadImage.mock.calls.find(([file]) => file instanceof File);
    expect(logo?.[1]).toBe("members/mem1");
  });
});

describe("submitStory", () => {
  // D6 (submission intake): was a silent return; now it says why.
  it("says a blank title needs filling in, and writes nothing", async () => {
    const from = db({});
    await expect(submitStory(form({ title: "  " })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/story/new?error=${encodeURIComponent("Give the story a title before saving.")}`);
    expect(from).not.toHaveBeenCalled();
  });

  it("redirects with the upload error and never inserts, when the cover fails validation", async () => {
    uploadImage.mockRejectedValue(new UploadRejectedError(IMAGE_TOO_LARGE));
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

    // industry_id crafted into the post: members never pick one, so it lands untagged for Jas
    await expect(submitStory(form({ title: "My Story!", category: "3", industry_id: "5" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");

    expect(storiesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      title: "My Story!", status: "awaiting_approval", source: "member", is_member_news: true, member_id: "mem1", submitted_by: "u1",
      cover_path: "stories/mem1/cover.jpg", industry_id: null,
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
    const videosBuilder = queryBuilder(dbOk({ id: "v1" }));
    db({ videos: () => videosBuilder });

    await expect(submitVideo(form({ title: "t", url: "https://youtube.com/watch?v=x", industry_id: "5" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=video");

    expect(videosBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", member_id: "mem1", industry_id: null }));
  });

  // Was ignored: the member was told "submitted" when nothing had saved (Luiza, 3 Nov).
  it("a failed insert goes back to the form, drops the thumbnail and tells nobody", async () => {
    uploadImage.mockResolvedValue("videos/t.jpg");
    db({ videos: () => queryBuilder(dbError("boom")) });
    await expect(submitVideo(form({ title: "t", url: "https://youtube.com/watch?v=x" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/video\/new\?error=That%20didn't%20save/);
    expect(removeMedia).toHaveBeenCalledWith("videos/t.jpg");
    expect(notifyConsole).not.toHaveBeenCalled();
  });
});

describe("submitEvent", () => {
  // D6 (submission intake): a blank title returned silently, and the start
  // date was only required by the browser.
  it.each([
    ["a blank title", { title: "", starts_on: "2026-09-01" }],
    ["no start date", { title: "t" }],
  ])("says why on %s, and writes nothing", async (_label, fields) => {
    const from = db({});
    await expect(submitEvent(form(fields)))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/event/new?error=${encodeURIComponent("A title and a start date are both required.")}`);
    expect(from).not.toHaveBeenCalled();
  });

  it("stores a recognised type, and null for anything unrecognised", async () => {
    const eventsBuilder = queryBuilder(dbOk(null));
    db({ events: () => eventsBuilder });

    await expect(submitEvent(form({ title: "t", type: "webinar", starts_on: "2026-09-01", industry_id: "5" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(eventsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ type: "webinar", industry_id: null }));

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

  // Industries are Jas's alone: the member's form has none, and a crafted post
  // that sends some changes nothing — neither the primary nor the set.
  const withIndustries = (fields: Record<string, string>, ids: number[]) => {
    const fd = form(fields);
    for (const id of ids) fd.append("industries", String(id));
    return fd;
  };

  it("an active member's revision carries no industries, even from a crafted post", async () => {
    const revisionsBuilder = queryBuilder(dbOk(null));
    const from = db({
      members: () => queryBuilder(dbOk({ slug: "acme", status: "active", draft_submitted_at: null, social: null, address: "", lat: null, lng: null })),
      member_revisions: () => revisionsBuilder,
    });

    // several ticks and no primary used to be refused; now it is simply ignored
    await expect(submitProfileEdit(withIndustries({ name: "Acme" }, [2, 7]))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=profile");
    await expect(submitProfileEdit(withIndustries({ name: "Acme", industry_id: "9" }, [2, 7]))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=profile");

    for (const [row] of callsOf(revisionsBuilder.insert) as unknown as [{ payload: Record<string, unknown> }][]) {
      expect(row.payload).not.toHaveProperty("industry_id");
      expect(row.payload).not.toHaveProperty("industry_ids");
    }
    expect(revisionsBuilder.insert).toHaveBeenCalledTimes(2);
    expect(from).not.toHaveBeenCalledWith("member_industries");
    expect(from).not.toHaveBeenCalledWith("industries");
  });

  it("a draft member's save leaves their industries exactly as Jas set them", async () => {
    const membersBuilder = queryBuilder(dbOk({ slug: "acme", status: "draft", draft_submitted_at: "2026-01-01T00:00:00.000Z", social: null, address: "", lat: null, lng: null }));
    const from = db({ members: () => membersBuilder });

    await expect(submitProfileEdit(withIndustries({ name: "Acme", industry_id: "4" }, [4]))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=page");

    const [written] = callsOf(membersBuilder.update)[0] as unknown as [Record<string, unknown>];
    expect(written).not.toHaveProperty("industry_id");
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

describe("withdrawStory / editStory", () => {
  it("withdrawStory does nothing for a story that isn't the member's own", async () => {
    const storiesBuilder = storyTable(memberStory({ member_id: "someone-else" }));
    db({ stories: () => storiesBuilder });

    await expect(withdrawStory(form({ id: "s1" }))).resolves.toBeUndefined();
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("withdrawStory tells the member when their story is already past the editable states", async () => {
    const storiesBuilder = storyTable(memberStory({ status: "published" }));
    db({ stories: () => storiesBuilder });
    await expect(withdrawStory(form({ id: "s1" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(STORY_CHANGED_ERROR)}`);
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("withdrawStory marks an owned, pending story withdrawn — conditional on the status it just read", async () => {
    const storiesBuilder = storyTable(memberStory({ status: "rejected" }));
    db({ stories: () => storiesBuilder });

    await expect(withdrawStory(form({ id: "s1" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(storiesBuilder.update).toHaveBeenCalledWith({ status: "withdrawn", updated_at: expect.any(String) });
    expect(storiesBuilder.eq).toHaveBeenCalledWith("status", "rejected");
    expect(storiesBuilder.eq).toHaveBeenCalledWith("member_id", "mem1");
    expect(storiesBuilder.eq).toHaveBeenCalledWith("source", "member");
  });

  // Review finding 16 Oct: the desk published it between the read and the write.
  it("withdrawStory reports the change, not success, when the conditional write matched nothing", async () => {
    db({ stories: () => storyTable(memberStory(), dbOk([])) });
    await expect(withdrawStory(form({ id: "s1" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(STORY_CHANGED_ERROR)}`);
  });

  it("editStory does nothing for a story that isn't owned and pending", async () => {
    const from = db({ stories: () => queryBuilder(dbOk(null)) });
    await expect(editStory(form({ id: "s1", title: "New title" }))).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalledWith("story_categories");
  });

  it("editStory resubmits, clearing the prior rejection reason", async () => {
    // cover_path already on file — a resubmit isn't forced to re-upload one
    const storiesBuilder = storyTable(memberStory({ status: "rejected" }));
    db({ stories: () => storiesBuilder });

    await expect(editStory(form({ id: "s1", title: "Fixed title", industry_id: "5" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");

    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      title: "Fixed title", status: "awaiting_approval", rejected_reason: null,
    }));
    // the industry is Jas's: a member edit never writes it, so Jas's tag survives
    expect(callsOf(storiesBuilder.update)[0][0]).not.toHaveProperty("industry_id");
  });

  it("editStory requires a cover on a legacy story that has neither an existing one nor a new upload", async () => {
    const storiesBuilder = storyTable(memberStory({ status: "rejected", cover_path: null }));
    db({ stories: () => storiesBuilder });

    await expect(editStory(form({ id: "s1", title: "Fixed title" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/story/s1/edit?error=A%20cover%20image%20is%20required.");
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  // Review finding 16 Oct: a form left open while Jas published could
  // "Save & resubmit" and pull the live story back into the queue.
  it("editStory refuses a story that went live since the form was opened, and says so", async () => {
    const storiesBuilder = storyTable(memberStory({ status: "published" }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Late edit" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(STORY_CHANGED_ERROR)}`);
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("editStory refuses a story the desk edited since the form was opened (version mismatch), before uploading anything", async () => {
    const storiesBuilder = storyTable(memberStory({ updated_at: "2026-10-15T11:30:00.5+00:00" }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Mine", version: "2026-10-15T09:00:00.123456+00:00" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(STORY_CHANGED_ERROR)}`);
    expect(storiesBuilder.update).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("editStory's write is conditional on the state and version it read", async () => {
    const row = memberStory();
    const storiesBuilder = storyTable(row);
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Mine", version: row.updated_at }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");
    expect(storiesBuilder.eq).toHaveBeenCalledWith("status", "awaiting_approval");
    expect(storiesBuilder.eq).toHaveBeenCalledWith("member_draft", false);
    expect(storiesBuilder.eq).toHaveBeenCalledWith("updated_at", row.updated_at);
    expect(storiesBuilder.eq).toHaveBeenCalledWith("member_id", "mem1");
  });

  it("editStory reports the change and drops the cover it uploaded when the conditional write matched nothing", async () => {
    uploadImage.mockResolvedValue("stories/new-cover.jpg");
    const from = db({ stories: () => storyTable(memberStory(), dbOk([])) });
    await expect(editStory(form({ id: "s1", title: "Mine", category: "3" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(STORY_CHANGED_ERROR)}`);
    expect(removeMedia).toHaveBeenCalledWith("stories/new-cover.jpg");
    expect(notifyConsole).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("story_categories");
  });

  it("editStory frees the cover a new upload replaced, through the in-use check", async () => {
    uploadImage.mockResolvedValue("stories/new-cover.jpg");
    db({ stories: () => storyTable(memberStory()) });
    await expect(editStory(form({ id: "s1", title: "Mine" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");
    expect(removeMediaIfUnused).toHaveBeenCalledWith(["stories/existing.jpg"]);
    expect(removeMedia).not.toHaveBeenCalledWith("stories/existing.jpg");
  });

  it("editStory keeps the cover when no new one was uploaded", async () => {
    uploadImage.mockResolvedValue(null);
    db({ stories: () => storyTable(memberStory()) });
    await expect(editStory(form({ id: "s1", title: "Mine" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");
    expect(removeMediaIfUnused).not.toHaveBeenCalled();
  });

  // USER DECISION 16 Oct: "the desk's work stays the desk's".
  it.each(["awaiting_approval", "rejected"])("a story the desk wrote about the member (%s) is neither editable nor withdrawable by them", async (status) => {
    const storiesBuilder = storyTable(memberStory({ status, source: "admin" }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Hijack" }))).resolves.toBeUndefined();
    await expect(withdrawStory(form({ id: "s1" }))).resolves.toBeUndefined();
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
    const raw = mockDb({ from: fromByTable({ stories: () => storiesBuilder }, () => queryBuilder(dbOk(null))) });
    vi.mocked(serviceDb).mockReturnValue(asDb(raw));
    await expect(submitStory(form({ title: "Mine", intent: "draft" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(raw.rpc).toHaveBeenCalledWith("replace_story_members", { p_story_id: "s1", p_member_ids: ["mem1"] });
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

  const draft = (over: Record<string, unknown> = {}) => memberStory({ status: "draft", member_draft: true, cover_path: null, ...over });

  it("editing a draft with Save draft keeps it a draft", async () => {
    const storiesBuilder = storyTable(draft());
    db({ stories: () => storiesBuilder });

    await expect(editStory(form({ id: "s1", title: "Still drafting", intent: "draft" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/story/s1/edit?saved=draft");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", member_draft: true }));
    expect(notifyConsole).not.toHaveBeenCalled();
  });

  it("submitting a draft needs a cover by then", async () => {
    const storiesBuilder = storyTable(draft());
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Done" })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/story/s1/edit?error=A%20cover%20image%20is%20required.");
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("submitting a draft hands it to the editor as a fresh submission", async () => {
    const storiesBuilder = storyTable(draft({ cover_path: "stories/c.jpg" }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Done" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", member_draft: false }));
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/^Submitted a story/) }));
  });

  it("Save draft can't pull an already-submitted story back out of the editor's queue", async () => {
    const storiesBuilder = storyTable(memberStory({ cover_path: "stories/c.jpg" }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "x", intent: "draft" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=story");
    expect(storiesBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", member_draft: false }));
  });

  it("an admin's draft that names the member is not the member's to edit", async () => {
    const storiesBuilder = storyTable(memberStory({ status: "draft", source: "admin", cover_path: "c.jpg" }));
    db({ stories: () => storiesBuilder });
    await expect(editStory(form({ id: "s1", title: "Hijack", intent: "draft" }))).resolves.toBeUndefined();
    expect(storiesBuilder.update).not.toHaveBeenCalled();
  });

  it("deleteStoryDraft deletes only the member's own draft — conditionally — and its cover and body images, if unused", async () => {
    const body = `<p>x</p><img src="https://cdn.test/storage/v1/object/public/media/stories/mem1/abc.jpg">` +
      `<img src="https://cdn.test/storage/v1/object/public/media/stories/other/zzz.jpg">`;
    const storiesBuilder = storyTable(draft(), dbOk([{ cover_path: "stories/c.jpg", body }]));
    db({ stories: () => storiesBuilder });
    await expect(deleteStoryDraft(form({ id: "s1" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard/submissions?deleted=draft");
    expect(storiesBuilder.delete).toHaveBeenCalled();
    expect(storiesBuilder.eq).toHaveBeenCalledWith("member_draft", true);
    expect(storiesBuilder.eq).toHaveBeenCalledWith("member_id", "mem1");
    // only this member's own uploads are offered — never another member's image
    expect(removeMediaIfUnused).toHaveBeenCalledWith(["stories/c.jpg", "stories/mem1/abc.jpg"]);
    expect(removeMedia).not.toHaveBeenCalled();
  });

  // Review finding 16 Oct: the delete's error was never read, so a failed
  // delete still removed the cover of a draft that still existed.
  it("deleteStoryDraft removes no media when the delete fails", async () => {
    db({ stories: () => storyTable(draft(), dbError("connection reset")) });
    await expect(deleteStoryDraft(form({ id: "s1" }))).rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/story\/s1\/edit\?error=/);
    expect(removeMediaIfUnused).not.toHaveBeenCalled();
    expect(removeMedia).not.toHaveBeenCalled();
  });

  it("deleteStoryDraft says so, and removes nothing, when the draft was submitted in the meantime", async () => {
    db({ stories: () => storyTable(draft(), dbOk([])) });
    await expect(deleteStoryDraft(form({ id: "s1" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(STORY_CHANGED_ERROR)}`);
    expect(removeMediaIfUnused).not.toHaveBeenCalled();
  });

  it.each([
    ["someone else's draft", { status: "draft", member_id: "other", member_draft: true }],
    ["an admin's draft naming the member", { status: "draft", member_id: "mem1", member_draft: false, source: "admin" }],
  ])("deleteStoryDraft refuses %s, silently", async (_label, row) => {
    const storiesBuilder = storyTable(memberStory(row));
    db({ stories: () => storiesBuilder });
    await expect(deleteStoryDraft(form({ id: "s1" }))).resolves.toBeUndefined();
    expect(storiesBuilder.delete).not.toHaveBeenCalled();
  });

  it("deleteStoryDraft on the member's own story that is no longer a draft says it changed", async () => {
    const storiesBuilder = storyTable(memberStory());
    db({ stories: () => storiesBuilder });
    await expect(deleteStoryDraft(form({ id: "s1" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(STORY_CHANGED_ERROR)}`);
    expect(storiesBuilder.delete).not.toHaveBeenCalled();
  });
});

describe("previewStoryBody", () => {
  it("cleans the body exactly as the published page will", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
    db({ members: () => queryBuilder(dbOk(null)) });
    const out = await previewStoryBody(`<p>Hi</p><script>alert(1)</script><img src="https://evil.example/x.jpg">`);
    expect(out).toBe("<p>Hi</p>");
  });

  it("closes with the member's own line to their member page, as the published page will", async () => {
    db({ members: () => queryBuilder(dbOk({ id: "mem1", name: "Acme", slug: "acme", website: null, status: "active", archived_at: null })) });
    expect(await previewStoryBody("<p>Hi</p>")).toBe(
      `<p>Hi</p><p data-company-link=""><a href="/member/acme" aria-label="Acme">Acme</a></p>`,
    );
  });

  it("is member-only", async () => {
    requireMemberView.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login?next=/dashboard"));
    await expect(previewStoryBody("<p>x</p>")).rejects.toThrow(/NEXT_REDIRECT/);
  });

  // Fix-list 94: it only reads, so an admin viewing as the member gets the
  // same preview the member would — closing with the viewed member's line.
  it("previews as the viewed member for an admin viewing as them", async () => {
    requireMemberView.mockResolvedValueOnce({ memberId: "mem2", email: "ops@beta.example", viewingAs: { adminUserId: "a1", adminName: "Jas" } });
    const from = db({ members: () => queryBuilder(dbOk({ id: "mem2", name: "Beta", slug: "beta", website: "https://beta.example", status: "active", archived_at: null })) });
    expect(await previewStoryBody("<p>Hi</p>")).toContain('href="/member/beta"');
    expect(from).toHaveBeenCalledWith("members");
    expect(requireMember).not.toHaveBeenCalled();
  });
});

/**
 * A `videos` or `events` table for the resubmit and withdraw paths: reads get
 * `row`, the conditional write gets `write` (the rows it changed). Submission
 * intake D6: these writes are now conditional, like editStory's.
 */
function contentTable(row: Record<string, unknown> | null, write: DbResult = dbOk([{ id: "x" }])) {
  const builder: ReturnType<typeof queryBuilder> = queryBuilder<unknown>((): DbResult => (callsOf(builder.update).length ? write : dbOk(row)));
  return builder;
}
const OPENED = "2026-11-03T09:00:00.123456+00:00";
const memberVideo = (over: Record<string, unknown> = {}) => ({ id: "v1", status: "awaiting_approval", member_id: "mem1", source: "member", updated_at: OPENED, ...over });
const memberEvent = (over: Record<string, unknown> = {}) => ({ id: "e1", status: "rejected", member_id: "mem1", source: "member", updated_at: OPENED, location: null, lat: null, lng: null, ...over });

describe("withdrawVideo / editVideo", () => {
  it("withdrawVideo does nothing for a video that isn't the member's", async () => {
    const videosBuilder = contentTable(null);
    db({ videos: () => videosBuilder });
    await expect(withdrawVideo(form({ id: "v1" }))).resolves.toBeUndefined();
    expect(videosBuilder.update).not.toHaveBeenCalled();
  });

  it("withdrawVideo marks an owned, pending video withdrawn, conditional on the status it read", async () => {
    const videosBuilder = contentTable(memberVideo());
    db({ videos: () => videosBuilder });
    await expect(withdrawVideo(form({ id: "v1" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "withdrawn" }));
    expect(videosBuilder.eq).toHaveBeenCalledWith("status", "awaiting_approval");
    expect(videosBuilder.eq).toHaveBeenCalledWith("member_id", "mem1");
  });

  // Was an unconditional write: a video Jas published in between was taken down.
  it("withdrawVideo on a video that went Live says it changed, and writes nothing", async () => {
    const videosBuilder = contentTable(memberVideo({ status: "published" }));
    db({ videos: () => videosBuilder });
    await expect(withdrawVideo(form({ id: "v1" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(MEMBER_CHANGED_ERROR.video)}`);
    expect(videosBuilder.update).not.toHaveBeenCalled();
  });

  it("editVideo requires both a title and a url on resubmission", async () => {
    const videosBuilder = contentTable(memberVideo());
    db({ videos: () => videosBuilder });

    await expect(editVideo(form({ id: "v1", title: "t", url: "" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/video/v1/edit?error=${encodeURIComponent("A title and a YouTube link are both required.")}`);

    expect(videosBuilder.update).not.toHaveBeenCalled();
  });

  it("editVideo refuses a link that isn't YouTube", async () => {
    const videosBuilder = contentTable(memberVideo());
    db({ videos: () => videosBuilder });

    await expect(editVideo(form({ id: "v1", title: "t", url: "https://vimeo.com/123" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/video\/v1\/edit\?error=.*YouTube/);

    expect(videosBuilder.update).not.toHaveBeenCalled();
  });

  it("editVideo resubmits with the new details", async () => {
    const videosBuilder = contentTable(memberVideo());
    db({ videos: () => videosBuilder });

    await expect(editVideo(form({ id: "v1", title: "t", url: "https://youtu.be/abc", industry_id: "5" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=video");

    expect(videosBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_approval", rejected_reason: null }));
    expect(callsOf(videosBuilder.update)[0][0]).not.toHaveProperty("industry_id");
  });

  // D6: the race the plan names — Jas approved while the form sat open.
  it("editVideo from a form opened before the desk acted is refused, and the video left as it is", async () => {
    const videosBuilder = contentTable(memberVideo({ status: "published", updated_at: "2026-11-03T10:00:00+00:00" }));
    db({ videos: () => videosBuilder });
    await expect(editVideo(form({ id: "v1", title: "t", url: "https://youtu.be/abc", version: OPENED })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(MEMBER_CHANGED_ERROR.video)}`);
    expect(videosBuilder.update).not.toHaveBeenCalled();
    expect(notifyConsole).not.toHaveBeenCalled();
  });

  it("editVideo whose conditional write matched nothing says it changed and drops the new thumbnail", async () => {
    uploadImage.mockResolvedValue("videos/new.jpg");
    db({ videos: () => contentTable(memberVideo(), dbOk([])) });
    await expect(editVideo(form({ id: "v1", title: "t", url: "https://youtu.be/abc", version: OPENED })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(MEMBER_CHANGED_ERROR.video)}`);
    expect(removeMedia).toHaveBeenCalledWith("videos/new.jpg");
  });

  it("a video the desk made about the member is not theirs to edit or withdraw", async () => {
    const videosBuilder = contentTable(memberVideo({ source: "manual" }));
    db({ videos: () => videosBuilder });
    await expect(editVideo(form({ id: "v1", title: "t", url: "https://youtu.be/abc" }))).resolves.toBeUndefined();
    await expect(withdrawVideo(form({ id: "v1" }))).resolves.toBeUndefined();
    expect(videosBuilder.update).not.toHaveBeenCalled();
  });
});

describe("withdrawEvent / editEvent", () => {
  it("withdrawEvent marks an owned, pending event withdrawn", async () => {
    const eventsBuilder = contentTable(memberEvent({ status: "awaiting_approval" }));
    db({ events: () => eventsBuilder });

    await expect(withdrawEvent(form({ id: "e1" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(eventsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "withdrawn" }));
    expect(eventsBuilder.eq).toHaveBeenCalledWith("status", "awaiting_approval");
  });

  it("withdrawEvent after Jas published says it changed, instead of taking it down", async () => {
    const eventsBuilder = contentTable(memberEvent({ status: "published" }));
    db({ events: () => eventsBuilder });
    await expect(withdrawEvent(form({ id: "e1" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/submissions?error=${encodeURIComponent(MEMBER_CHANGED_ERROR.event)}`);
    expect(eventsBuilder.update).not.toHaveBeenCalled();
  });

  it("editEvent stores a recognised type and resubmits", async () => {
    const eventsBuilder = contentTable(memberEvent());
    db({ events: () => eventsBuilder });

    await expect(editEvent(form({ id: "e1", title: "t", starts_on: "2026-09-01", type: "webinar", industry_id: "5" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=event");

    expect(eventsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ type: "webinar", status: "awaiting_approval" }));
    expect(callsOf(eventsBuilder.update)[0][0]).not.toHaveProperty("industry_id");
  });

  // D6: was a silent return.
  it("editEvent says a blank title needs filling in", async () => {
    const eventsBuilder = contentTable(memberEvent());
    db({ events: () => eventsBuilder });

    await expect(editEvent(form({ id: "e1", title: "  ", starts_on: "2026-09-01" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/event/e1/edit?error=${encodeURIComponent("A title and a start date are both required.")}`);

    expect(eventsBuilder.update).not.toHaveBeenCalled();
  });

  it("editEvent keeps the old map pin when a changed location fails to geocode", async () => {
    const eventsBuilder = contentTable(memberEvent({ location: "Leeds", lat: 53.8, lng: -1.5 }));
    db({ events: () => eventsBuilder });
    await expect(editEvent(form({ id: "e1", title: "t", starts_on: "2026-09-01", location: "Nowhere" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=event");
    expect(geocodeAddress).toHaveBeenCalledWith("Nowhere");
    expect(eventsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ location: "Nowhere", lat: 53.8, lng: -1.5 }));
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

  describe("Featured Member preferred month", () => {
    // A month inside the live window whatever day the suite runs.
    const next = featuredMonths([], new Date())[1];
    const fullRuns = Array.from({ length: FEATURED_SLOTS.cap }, () => ({ starts_on: next.first, ends_on: next.last }));

    it("stores the month's 1st when it has room", async () => {
      const requests = queryBuilder(dbOk(null));
      const placements = queryBuilder(dbOk([]));
      db({ visibility_requests: () => requests, placements: () => placements });

      await expect(requestVisibility(form({ product: "featured_member", preferred_month: next.key }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=buy");
      expect(placements.eq).toHaveBeenCalledWith("kind", "featured_member");
      expect(requests.insert).toHaveBeenCalledWith(expect.objectContaining({ product: "featured_member", preferred_month: next.first }));
    });

    it("refuses a month that filled up since the page loaded", async () => {
      const requests = queryBuilder(dbOk(null));
      db({ visibility_requests: () => requests, placements: () => queryBuilder(dbOk(fullRuns)) });

      await expect(requestVisibility(form({ product: "featured_member", preferred_month: next.key }))).rejects.toThrow(
        `NEXT_REDIRECT:/dashboard/advertising/buy?error=${encodeURIComponent(`${next.label} has just filled up — pick another month.`)}`,
      );
      expect(requests.insert).not.toHaveBeenCalled();
    });

    it("refuses a month outside the window", async () => {
      const requests = queryBuilder(dbOk(null));
      db({ visibility_requests: () => requests, placements: () => queryBuilder(dbOk([])) });

      await expect(requestVisibility(form({ product: "featured_member", preferred_month: "1999-01" }))).rejects.toThrow(
        "NEXT_REDIRECT:/dashboard/advertising/buy?error=",
      );
      expect(requests.insert).not.toHaveBeenCalled();
    });

    it("ignores a month on any other product, without querying placements", async () => {
      const requests = queryBuilder(dbOk(null));
      db({ visibility_requests: () => requests });

      await expect(requestVisibility(form({ product: "newsletter_slot", preferred_month: next.key }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=buy");
      expect(requests.insert).toHaveBeenCalledWith(expect.objectContaining({ product: "newsletter_slot", preferred_month: null }));
    });

    it("stores null for no preference", async () => {
      const requests = queryBuilder(dbOk(null));
      db({ visibility_requests: () => requests });

      await expect(requestVisibility(form({ product: "featured_member", preferred_month: "" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=buy");
      expect(requests.insert).toHaveBeenCalledWith(expect.objectContaining({ preferred_month: null }));
    });
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

  it("cleans up uploaded artwork when the advert insert fails, logging the database's text rather than showing it", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce("panels/mem1/m.jpg");
    db({ adverts: () => queryBuilder(dbError("write failed")) });

    const thrown = await submitAdvert(advertForm()).catch((e: Error) => e);
    expect(String(thrown)).toMatch(/NEXT_REDIRECT:\/dashboard\/advertising\/buy\?error=That%20didn/);
    expect(String(thrown)).not.toMatch(/write%20failed/);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "action:submitAdvert" }));
    expect(removeMedia).toHaveBeenCalledWith("panels/mem1/d.jpg");
    expect(removeMedia).toHaveBeenCalledWith("panels/mem1/m.jpg");
  });

  it("logs, and doesn't show, a booking rejection that isn't about the dates", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce("panels/mem1/m.jpg");
    db({
      adverts: () => queryBuilder(dbOk({ id: "ad1" })),
      advert_bookings: () => queryBuilder(dbError("conflicting key value violates exclusion constraint \"advert_bookings_no_overlap\"")),
    });

    const thrown = await submitAdvert(advertForm()).catch((e: Error) => e);
    expect(String(thrown)).toMatch(/error=That%20didn/);
    expect(String(thrown)).not.toMatch(/exclusion|no_overlap/);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "action:submitAdvert" }));
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

  // 16 Oct: /visit redirects readers straight to the stored link, and the
  // member's form stored whatever was typed.
  it("refuses a click-through link that isn't a web address, before uploading anything", async () => {
    const from = db({});
    await expect(submitAdvert(advertForm({ link_url: "javascript:alert(1)" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/advertising/buy?error=${encodeURIComponent("The click-through link must be a web address, e.g. https://www.example.co.uk.")}`);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("stores a typed link as an absolute https address", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce("panels/mem1/m.jpg");
    const advertsBuilder = queryBuilder(dbOk({ id: "ad1" }));
    db({ adverts: () => advertsBuilder, advert_bookings: () => queryBuilder(dbOk(null)) });
    await expect(submitAdvert(advertForm({ link_url: "www.acme.co.uk" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=advert");
    expect(advertsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ link_url: "https://www.acme.co.uk" }));
  });
});

describe("resubmitAdvert", () => {
  it("refuses a click-through link that isn't a web address, before uploading anything", async () => {
    const bookings = queryBuilder(dbOk({ id: "b1", status: "draft", advert_id: "ad1", advert: { id: "ad1", member_id: "mem1" } }));
    const from = db({ advert_bookings: () => bookings });
    await expect(resubmitAdvert(form({ id: "b1", link_url: "data:text/html,hi" })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/advert/b1?error=${encodeURIComponent("The click-through link must be a web address, e.g. https://www.example.co.uk.")}`);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("adverts");
  });

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
  const today = new Date().toISOString().slice(0, 10);
  const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const ended = { id: "b1", status: "ended", advert_id: "ad1", price_pennies: 65000, starts_on: "2026-01-01", ends_on: "2026-01-31", advert: { member_id: "mem1" } };

  it("does nothing for a run that isn't the caller's own advert", async () => {
    db({ advert_bookings: () => queryBuilder(dbOk({ ...ended, advert: { member_id: "someone-else" } })) });

    await expect(renewAdvertBooking(form({ id: "b1" }))).resolves.toBeUndefined();
  });

  it("books a fresh run linked back to the one it renews, and links the console to the new booking", async () => {
    let call = 0;
    // 1: the ownership read, 2: the insert returning the new booking
    const bookingsBuilder = queryBuilder(() => (call++ === 0 ? dbOk(ended) : dbOk({ id: "b2" })));
    db({ advert_bookings: () => bookingsBuilder });

    await expect(renewAdvertBooking(form({ id: "b1", starts_on: inDays(7), ends_on: inDays(37) })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=advert");

    // last run's price carries over for the admin to confirm on approval (fix-list 77)
    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ advert_id: "ad1", renewed_from: "b1", price_pennies: 65000 }));
    expect(notifyConsole).toHaveBeenCalledWith(expect.objectContaining({ payload: { booking_id: "b2" } }));
  });

  // 16 Oct: a double-submitted form wrote two identical requests
  // (migration 20261016000061 now refuses the second).
  it("says the run was already asked for, rather than failing, on a second submit", async () => {
    let call = 0;
    const bookingsBuilder = queryBuilder(() => (call++ === 0
      ? dbOk(ended)
      : dbError('duplicate key value violates unique constraint "advert_bookings_one_pending_member_renewal"', { code: "23505" })));
    db({ advert_bookings: () => bookingsBuilder });

    await expect(renewAdvertBooking(form({ id: "b1", starts_on: inDays(7), ends_on: inDays(37) })))
      .rejects.toThrow(`NEXT_REDIRECT:/dashboard/advert/b1?error=${encodeURIComponent("You've already asked to book this run again — that request is waiting for a decision.")}`);
    expect(notifyConsole).not.toHaveBeenCalled();
  });

  // Review finding 16 Oct: any status was renewable — a live run, one awaiting
  // payment, one still in draft — each queueing a duplicate request.
  it.each(["draft", "awaiting_approval", "review_required", "awaiting_payment"])("refuses a %s run, which isn't finished", async (status) => {
    const bookingsBuilder = queryBuilder(dbOk({ ...ended, status }));
    db({ advert_bookings: () => bookingsBuilder });
    await expect(renewAdvertBooking(form({ id: "b1", starts_on: inDays(7), ends_on: inDays(37) })))
      .rejects.toThrow("NEXT_REDIRECT:/dashboard/advert/b1?error=Only%20a%20run%20that%20has%20finished%20can%20be%20booked%20again.");
    expect(bookingsBuilder.insert).not.toHaveBeenCalled();
  });

  it("refuses a live run whose term isn't over", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ ...ended, status: "live", starts_on: inDays(-3), ends_on: inDays(10) }));
    db({ advert_bookings: () => bookingsBuilder });
    await expect(renewAdvertBooking(form({ id: "b1", starts_on: inDays(11), ends_on: inDays(40) }))).rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/advert\/b1\?error=Only/);
    expect(bookingsBuilder.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["missing dates", "", ""],
    ["an impossible date", "2026-02-30", "2026-03-30"],
    ["a start in the past", "2020-01-01", "2020-02-01"],
    ["an end before the start", inDays(20), inDays(10)],
  ])("refuses %s before inserting anything", async (_label, starts_on, ends_on) => {
    const bookingsBuilder = queryBuilder(dbOk(ended));
    db({ advert_bookings: () => bookingsBuilder });
    await expect(renewAdvertBooking(form({ id: "b1", starts_on, ends_on }))).rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/advert\/b1\?error=/);
    expect(bookingsBuilder.insert).not.toHaveBeenCalled();
    expect(notifyConsole).not.toHaveBeenCalled();
  });

  it("a run starting today is fine", async () => {
    let call = 0;
    db({ advert_bookings: () => queryBuilder(() => (call++ === 0 ? dbOk(ended) : dbOk({ id: "b2" }))) });
    await expect(renewAdvertBooking(form({ id: "b1", starts_on: today, ends_on: today }))).rejects.toThrow("NEXT_REDIRECT:/dashboard?submitted=advert");
  });

  it("tells the member, and notifies nobody, when the insert fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    db({ advert_bookings: () => queryBuilder(() => (call++ === 0 ? dbOk(ended) : dbError("violates foreign key"))) });
    await expect(renewAdvertBooking(form({ id: "b1", starts_on: inDays(7), ends_on: inDays(37) })))
      .rejects.toThrow(/NEXT_REDIRECT:\/dashboard\/advert\/b1\?error=The%20new%20run/);
    expect(notifyConsole).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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

  it("logs, and doesn't show, any other rejection of the swap", async () => {
    uploadImage.mockResolvedValueOnce("panels/mem1/d.jpg").mockResolvedValueOnce("panels/mem1/m.jpg");
    db({
      adverts: () => queryBuilder(dbOk({ id: "ad1", member_id: "mem1" })),
      advert_artwork_proposals: () => queryBuilder(dbError("permission denied for table advert_artwork_proposals")),
    });

    const thrown = await proposeOwnArtworkSwap(form({ advert_id: "ad1", booking_id: "b1" })).catch((e: Error) => e);
    expect(String(thrown)).toMatch(/NEXT_REDIRECT:\/dashboard\/advert\/b1\?error=That%20didn/);
    expect(String(thrown)).not.toMatch(/permission/);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "action:proposeOwnArtworkSwap" }));
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

  it("does nothing while Leads is switched off in /console/features", async () => {
    const mark = withSource(["https://www.linkedin.com/company/acme"]);
    isFeatureEnabled.mockResolvedValue(false);

    await markProspectFollowUp(form({ ref: "https://www.linkedin.com/company/acme" }));

    expect(isFeatureEnabled).toHaveBeenCalledWith("member_leads");
    expect(mark).not.toHaveBeenCalled();
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

  it("does nothing while Leads is switched off in /console/features", async () => {
    const marks = queryBuilder(dbOk({ id: "mark1", member_id: "mem1" }));
    db({ prospect_marks: () => marks });
    isFeatureEnabled.mockResolvedValue(false);

    await unmarkProspect(form({ id: "mark1" }));

    expect(marks.delete).not.toHaveBeenCalled();
  });
});
