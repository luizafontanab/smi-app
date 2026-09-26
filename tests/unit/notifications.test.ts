import { afterEach, describe, expect, it, vi } from "vitest";
import { notificationSlugs, unreadNotificationCount } from "@/lib/notifications";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

/**
 * Member notification reads, previously at 0%.
 *
 * Two behaviours here are worth pinning rather than trusting. The id collection
 * must not fan a notification list out into a round trip per row, and the
 * member link must not point at a page the public cannot see — an archived or
 * lapsed member would otherwise get a link to a 404 (fix-list 72). Both are
 * invisible in the rendered output when they break.
 */
const MEMBER = "22222222-2222-2222-2222-222222222222";

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("unreadNotificationCount", () => {
  it("returns the head-count", async () => {
    db({ notifications: () => queryBuilder(dbOk(null, 4)) });
    await expect(unreadNotificationCount(MEMBER)).resolves.toBe(4);
  });

  it("returns 0 rather than null when the count comes back empty", async () => {
    db({ notifications: () => queryBuilder(dbOk(null, null)) });
    await expect(unreadNotificationCount(MEMBER)).resolves.toBe(0);
  });

  it("returns 0 on an error rather than throwing at the dashboard", async () => {
    db({ notifications: () => queryBuilder({ data: null, error: { message: "boom" }, count: null }) });
    await expect(unreadNotificationCount(MEMBER)).resolves.toBe(0);
  });
});

describe("notificationSlugs", () => {
  const member = (row: Record<string, unknown> | null) => () => queryBuilder(dbOk(row));

  it("maps ids to slug + status for each content type", async () => {
    db({
      stories: () => queryBuilder(dbOk([{ id: "s1", slug: "a-story", status: "published" }])),
      videos: () => queryBuilder(dbOk([{ id: "v1", slug: "a-video", status: "published" }])),
      events: () => queryBuilder(dbOk([{ id: "e1", slug: "an-event", status: "published" }])),
      members: member({ slug: "acme", status: "active", archived_at: null }),
    });

    const maps = await notificationSlugs(
      [
        { kind: "story_live", payload: { story_id: "s1" } },
        { kind: "video_live", payload: { video_id: "v1" } },
        { kind: "event_live", payload: { event_id: "e1" } },
      ],
      MEMBER,
    );

    expect(maps.stories).toEqual({ s1: { slug: "a-story", status: "published" } });
    expect(maps.videos).toEqual({ v1: { slug: "a-video", status: "published" } });
    expect(maps.events).toEqual({ e1: { slug: "an-event", status: "published" } });
    expect(maps.member).toBe("acme");
  });

  it("makes no content query at all for purely billing notifications", async () => {
    const from = db({ members: member({ slug: "acme", status: "active", archived_at: null }) });

    const maps = await notificationSlugs(
      [{ kind: "payment_taken", payload: { amount: 4000 } }, { kind: "invoice", payload: null }],
      MEMBER,
    );

    const tables = from.mock.calls.map(([t]) => t);
    expect(tables).toEqual(["members"]);
    expect(maps.stories).toEqual({});
    expect(maps.videos).toEqual({});
    expect(maps.events).toEqual({});
  });

  it("de-duplicates repeated ids into one query's worth of input", async () => {
    let received: unknown;
    const builder = queryBuilder(dbOk([{ id: "s1", slug: "a-story", status: "published" }]));
    // Capture what .in() was handed — the de-duplication is the assertion.
    // Mutate the builder rather than spreading a copy: every chain method
    // returns the builder object itself, so a copy is never reached.
    builder.in = vi.fn((_col: string, ids: unknown) => { received = ids; return builder; });
    db({
      stories: () => builder,
      members: member({ slug: "acme", status: "active", archived_at: null }),
    });

    await notificationSlugs(
      [
        { kind: "story_live", payload: { story_id: "s1" } },
        { kind: "story_rejected", payload: { story_id: "s1" } },
      ],
      MEMBER,
    );

    expect(received).toEqual(["s1"]);
  });

  it("leaves an id out of the map when its row is gone", async () => {
    db({
      stories: () => queryBuilder(dbOk([])),
      members: member({ slug: "acme", status: "active", archived_at: null }),
    });
    const maps = await notificationSlugs([{ kind: "story_live", payload: { story_id: "deleted" } }], MEMBER);
    expect(maps.stories).toEqual({});
  });

  it("ignores non-string and empty payload ids", async () => {
    const from = db({ members: member({ slug: "acme", status: "active", archived_at: null }) });
    await notificationSlugs(
      [
        { kind: "x", payload: { story_id: 123 } },
        { kind: "y", payload: { story_id: "" } },
        { kind: "z", payload: null },
      ],
      MEMBER,
    );
    expect(from.mock.calls.map(([t]) => t)).toEqual(["members"]);
  });

  it("withholds the member link when the member is archived", async () => {
    db({ members: member({ slug: "acme", status: "active", archived_at: "2026-09-01T00:00:00Z" }) });
    const maps = await notificationSlugs([], MEMBER);
    expect(maps.member).toBeNull();
  });

  it("withholds the member link when the status is not publicly served", async () => {
    db({ members: member({ slug: "acme", status: "lapsed", archived_at: null }) });
    const maps = await notificationSlugs([], MEMBER);
    expect(maps.member).toBeNull();
  });

  it("keeps the link for a member in grace", async () => {
    db({ members: member({ slug: "acme", status: "grace", archived_at: null }) });
    const maps = await notificationSlugs([], MEMBER);
    expect(maps.member).toBe("acme");
  });

  it("withholds the member link when there is no member row", async () => {
    db({ members: member(null) });
    const maps = await notificationSlugs([], MEMBER);
    expect(maps.member).toBeNull();
  });
});
