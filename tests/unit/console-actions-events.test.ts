import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consoleUploadEventImage, decideEvent, decideRevision, moveEvent, resetLayout, saveEvent, saveLayout, setEventStatus,
} from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { revalidatePath } from "next/cache";
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
  vi.mocked(revalidatePath).mockClear();
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

describe("consoleUploadEventImage", () => {
  it("uploads under events/console", async () => {
    await consoleUploadEventImage(form({}));
    expect(uploadImage).toHaveBeenCalledWith(null, "events/console");
  });
});

describe("saveEvent", () => {
  // See the note in console-actions-stories.test.ts — fix-list 73 turned these
  // silent returns into a redirect that tells you what is missing.
  it("requires a title and a start date, and says so", async () => {
    const from = db({});
    await expect(saveEvent(form({ title: "t", starts_on: "" }))).rejects.toThrow(/NEXT_REDIRECT.*error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("stores a recognised event type and null for anything else", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1" }));
    db({ events: () => eventsBuilder });

    await expect(saveEvent(form({ title: "t", starts_on: "2026-09-01", type: "webinar" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/events/e1");
    expect(eventsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ type: "webinar", status: "draft" }));
  });

  it("writes the industry, and clears it when the select is left blank", async () => {
    // events.industry_id had no writer at all before this field — migration
    // 20260909000002's backfill set it on nothing, since prod events have no member.
    const eventsBuilder = queryBuilder(dbOk({ id: "e1" }));
    db({ events: () => eventsBuilder });

    await expect(saveEvent(form({ title: "t", starts_on: "2026-09-01", industry_id: "4" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/events/e1");
    expect(eventsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ industry_id: 4 }));

    await expect(saveEvent(form({ title: "t", starts_on: "2026-09-01", industry_id: "" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/events/e1");
    expect(eventsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ industry_id: null }));
  });
});

describe("decideEvent", () => {
  it("ignores an event that isn't awaiting approval", async () => {
    const from = db({ events: () => queryBuilder(dbOk({ id: "e1", status: "published" })) });
    await decideEvent(form({ id: "e1", decision: "approve" }));
    expect(from).not.toHaveBeenCalledWith("approvals");
  });

  it("approving publishes and notifies the member, with no social push (events have none)", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1", member_id: "m1", status: "awaiting_approval" }));
    db({ events: () => eventsBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideEvent(form({ id: "e1", decision: "approve" }));

    expect(eventsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "event_published" }));
    expect(enqueue).not.toHaveBeenCalledWith("social_push", expect.anything(), expect.anything());
  });
});

describe("moveEvent", () => {
  it("reports a not-found event rather than throwing", async () => {
    db({ events: () => queryBuilder(dbOk(null)) });
    expect(await moveEvent({ id: "missing", to: "published" })).toEqual({ ok: false, error: "Event not found." });
  });

  it("refuses an illegal transition without touching the row", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1", status: "published", member_id: null }));
    db({ events: () => eventsBuilder });

    const result = await moveEvent({ id: "e1", to: "awaiting_approval" });

    expect(result.ok).toBe(false);
    expect(eventsBuilder.update).not.toHaveBeenCalled();
  });

  it("publishing a console-authored draft directly, with no approval row", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1", status: "draft", member_id: "m1" }));
    const from = db({ events: () => eventsBuilder });

    const result = await moveEvent({ id: "e1", to: "published" });

    expect(result).toEqual({ ok: true });
    expect(eventsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "event_published" }));
    expect(from).not.toHaveBeenCalledWith("approvals");
  });

  it("publishing from awaiting_approval also records the approval, mirroring decideEvent", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1", status: "awaiting_approval", member_id: "m1" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ events: () => eventsBuilder, approvals: () => approvalsBuilder });

    const result = await moveEvent({ id: "e1", to: "published" });

    expect(result).toEqual({ ok: true });
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ decision: "approved" }));
  });

  it("taking a published event back to draft just updates the status", async () => {
    const eventsBuilder = queryBuilder(dbOk({ id: "e1", status: "published", member_id: null }));
    db({ events: () => eventsBuilder });

    const result = await moveEvent({ id: "e1", to: "draft" });

    expect(result).toEqual({ ok: true });
    expect(eventsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" }));
  });
});

describe("setEventStatus", () => {
  it("does nothing without both an id and a status", async () => {
    await expect(setEventStatus(form({ id: "e1" }))).resolves.toBeUndefined();
  });

  it("moves the card and redirects back to the board", async () => {
    db({ events: () => queryBuilder(dbOk({ id: "e1", status: "draft", member_id: null })) });

    await expect(setEventStatus(form({ id: "e1", status: "published" }))).rejects.toThrow("NEXT_REDIRECT:/console/events");
  });
});

describe("decideRevision", () => {
  it("ignores a revision that isn't awaiting approval", async () => {
    const from = db({ member_revisions: () => queryBuilder(dbOk({ id: "r1", status: "published" })) });
    await decideRevision(form({ id: "r1", decision: "approve" }));
    expect(from).not.toHaveBeenCalledWith("members");
  });

  it("approving sanitises the description and applies the payload to the member", async () => {
    const membersBuilder = queryBuilder(dbOk(null));
    const revisionsBuilder = queryBuilder(dbOk({
      id: "r1", member_id: "m1", status: "awaiting_approval",
      payload: { description: "<script>alert(1)</script><p>Hello</p>" },
    }));
    db({ member_revisions: () => revisionsBuilder, members: () => membersBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideRevision(form({ id: "r1", decision: "approve" }));

    const [payload] = (membersBuilder.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.description).not.toContain("<script>");
    expect(payload.description).toContain("Hello");
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "page_changes_live" }));
  });

  // `service_ids` is not a members column — it rides the payload because a
  // member's profile edit has no other channel, and must be pulled out before
  // the members UPDATE or Postgres rejects the whole thing.
  it("approving applies service_ids to member_services and keeps them out of the member row", async () => {
    const membersBuilder = queryBuilder(dbOk(null));
    const servicesBuilder = queryBuilder(dbOk(null));
    const revisionsBuilder = queryBuilder(dbOk({
      id: "r1", member_id: "m1", status: "awaiting_approval",
      payload: { website: "https://example.com", service_ids: [3, 7] },
    }));
    db({
      member_revisions: () => revisionsBuilder,
      members: () => membersBuilder,
      member_services: () => servicesBuilder,
      approvals: () => queryBuilder(dbOk(null)),
    });

    await decideRevision(form({ id: "r1", decision: "approve" }));

    const [payload] = (membersBuilder.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).not.toHaveProperty("service_ids");
    expect(payload.website).toBe("https://example.com");
    expect(servicesBuilder.delete).toHaveBeenCalled();
    expect(servicesBuilder.insert).toHaveBeenCalledWith([
      { member_id: "m1", service_id: 3 },
      { member_id: "m1", service_id: 7 },
    ]);
  });

  // A revision written before the services picker existed carries no
  // service_ids key at all. Approving it must not read that absence as "clear
  // every service this member has".
  it("approving a revision with no service_ids leaves the member's services alone", async () => {
    const servicesBuilder = queryBuilder(dbOk(null));
    db({
      member_revisions: () => queryBuilder(dbOk({ id: "r1", member_id: "m1", status: "awaiting_approval", payload: { website: "x" } })),
      members: () => queryBuilder(dbOk(null)),
      member_services: () => servicesBuilder,
      approvals: () => queryBuilder(dbOk(null)),
    });

    await decideRevision(form({ id: "r1", decision: "approve" }));

    expect(servicesBuilder.delete).not.toHaveBeenCalled();
  });

  it("approving with an empty service_ids clears the member's services", async () => {
    const servicesBuilder = queryBuilder(dbOk(null));
    db({
      member_revisions: () => queryBuilder(dbOk({ id: "r1", member_id: "m1", status: "awaiting_approval", payload: { service_ids: [] } })),
      members: () => queryBuilder(dbOk(null)),
      member_services: () => servicesBuilder,
      approvals: () => queryBuilder(dbOk(null)),
    });

    await decideRevision(form({ id: "r1", decision: "approve" }));

    expect(servicesBuilder.delete).toHaveBeenCalled();
    expect(servicesBuilder.insert).not.toHaveBeenCalled();
  });

  it("rejecting notifies the member with the reason and never touches the member row", async () => {
    const membersBuilder = queryBuilder(dbOk(null));
    const revisionsBuilder = queryBuilder(dbOk({ id: "r1", member_id: "m1", status: "awaiting_approval", payload: {} }));
    db({ member_revisions: () => revisionsBuilder, members: () => membersBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideRevision(form({ id: "r1", decision: "reject", reason: "Needs more detail" }));

    expect(membersBuilder.update).not.toHaveBeenCalled();
    expect(revisionsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", rejected_reason: "Needs more detail" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "page_changes_rejected", reason: "Needs more detail" }));
  });
});

describe("saveLayout", () => {
  it("redirects with an error for an unrecognised page type, without writing", async () => {
    const from = db({});
    await expect(saveLayout(form({ page_type: "bogus", layout: "{}" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/pages\?type=bogus&error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("redirects with an error for malformed JSON, without writing", async () => {
    const from = db({});
    await expect(saveLayout(form({ page_type: "story", layout: "{not json" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/pages\?type=story&error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("redirects with the validation error for an invalid layout, without writing it", async () => {
    const from = db({});
    await expect(saveLayout(form({ page_type: "story", layout: JSON.stringify({ blocks: "nope" }) })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/pages\?type=story&error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("upserts a valid layout keyed by page_type + entity_id and redirects with saved=1", async () => {
    const layoutsBuilder = queryBuilder(dbOk(null));
    db({ page_layouts: () => layoutsBuilder });
    const { DEFAULT_LAYOUTS } = await import("@/lib/blocks/defaults");

    await expect(saveLayout(form({ page_type: "story", entity_id: "s1", layout: JSON.stringify(DEFAULT_LAYOUTS.story) })))
      .rejects.toThrow("NEXT_REDIRECT:/console/pages?type=story&entity=s1&saved=1");

    expect(layoutsBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ page_type: "story", entity_id: "s1" }),
      { onConflict: "page_type,entity_id" },
    );
  });
});

describe("resetLayout", () => {
  it("scopes the delete to the entity when given, or the type default when not", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ page_layouts: () => builder });

    await expect(resetLayout(form({ page_type: "story", entity_id: "s1" }))).rejects.toThrow("NEXT_REDIRECT:/console/pages?type=story&entity=s1");
    expect(builder.eq).toHaveBeenCalledWith("entity_id", "s1");

    await expect(resetLayout(form({ page_type: "story" }))).rejects.toThrow("NEXT_REDIRECT:/console/pages?type=story");
    expect(builder.is).toHaveBeenCalledWith("entity_id", null);
  });
});
