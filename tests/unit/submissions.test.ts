import { afterEach, describe, expect, it, vi } from "vitest";
import { pendingSubmissions } from "@/lib/submissions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk([], 0)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

const row = (id: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Title ${id}`, status: "awaiting_approval", rejected_reason: null, created_at, ...extra,
});

describe("pendingSubmissions", () => {
  it("merges all four content types newest-first, with per-kind edit hrefs", async () => {
    db({
      stories: () => queryBuilder(dbOk([row("s1", "2026-09-01T10:00:00Z")], 1)),
      videos: () => queryBuilder(dbOk([row("v1", "2026-09-03T10:00:00Z")], 1)),
      events: () => queryBuilder(dbOk([row("e1", "2026-09-02T10:00:00Z", { status: "rejected", rejected_reason: "Too short" })], 1)),
      featured_machines: () => queryBuilder(dbOk([{ id: "m1", name: "Press brake", status: "awaiting_approval", rejected_reason: null, created_at: "2026-09-04T10:00:00Z" }], 1)),
    });

    const { items, total } = await pendingSubmissions("mem1");

    expect(total).toBe(4);
    expect(items.map((i) => i.id)).toEqual(["m1", "v1", "e1", "s1"]);
    expect(items[0]).toMatchObject({ kind: "machine", title: "Press brake", editHref: "/dashboard/equipment/m1/edit" });
    expect(items[1]).toMatchObject({ kind: "video", editHref: "/dashboard/video/v1/edit" });
    expect(items[2]).toMatchObject({ kind: "event", status: "rejected", rejected_reason: "Too short", editHref: "/dashboard/event/e1/edit" });
    expect(items[3]).toMatchObject({ kind: "story", editHref: "/dashboard/story/s1/edit" });
  });

  it("scopes every query to the member and to the pre-approval statuses", async () => {
    const stories = queryBuilder(dbOk([], 0));
    db({ stories: () => stories });

    await pendingSubmissions("mem1");

    expect(stories.eq).toHaveBeenCalledWith("member_id", "mem1");
    expect(stories.in).toHaveBeenCalledWith("status", ["awaiting_approval", "rejected"]);
    expect(stories.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(stories.limit).not.toHaveBeenCalled();
  });

  it("with a limit, trims the merged list but keeps the true total for the badge", async () => {
    const stories = queryBuilder(dbOk([row("s1", "2026-09-05T10:00:00Z"), row("s2", "2026-09-01T10:00:00Z")], 7));
    db({
      stories: () => stories,
      videos: () => queryBuilder(dbOk([row("v1", "2026-09-03T10:00:00Z")], 3)),
    });

    const { items, total } = await pendingSubmissions("mem1", { limit: 2 });

    expect(stories.limit).toHaveBeenCalledWith(2);
    expect(items.map((i) => i.id)).toEqual(["s1", "v1"]);
    expect(total).toBe(10);
  });

  it("returns an empty list and zero total when nothing is pending", async () => {
    db({});
    expect(await pendingSubmissions("mem1")).toEqual({ items: [], total: 0 });
  });

  it("degrades to an empty box when a query fails, rather than throwing", async () => {
    // A failed select returns data: null and no count. The dashboard box is a
    // sidebar widget — it must not take the whole page down with it, so every
    // read is defended with a fallback. This covers all four tables at once.
    db({
      stories: () => queryBuilder(dbError("stories exploded")),
      videos: () => queryBuilder(dbError("videos exploded")),
      events: () => queryBuilder(dbError("events exploded")),
      featured_machines: () => queryBuilder(dbError("machines exploded")),
    });

    expect(await pendingSubmissions("mem1")).toEqual({ items: [], total: 0 });
  });

  it("still merges the tables that succeeded when only one fails", async () => {
    db({
      stories: () => queryBuilder(dbOk([row("s1", "2026-09-01T10:00:00Z")], 1)),
      videos: () => queryBuilder(dbError("videos exploded")),
    });

    const { items, total } = await pendingSubmissions("mem1");

    expect(items.map((i) => i.id)).toEqual(["s1"]);
    expect(total).toBe(1);
  });
});
