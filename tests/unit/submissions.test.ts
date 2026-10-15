import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTENT_FILTERS, isContentFilter, memberContent, pendingSubmissions } from "@/lib/submissions";
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

  // Jas 13/10: a `draft` story is only listed when the member saved it — an
  // admin's draft naming them is the desk's unfinished work.
  it("lists story drafts only when they are the member's own, and marks them", async () => {
    const stories = queryBuilder(dbOk([row("s1", "2026-09-01T10:00:00Z", { status: "draft", member_draft: true })], 1));
    db({ stories: () => stories });

    const { items } = await memberContent("mem1", { statuses: CONTENT_FILTERS.drafts });

    expect(stories.or).toHaveBeenCalledWith("status.neq.draft,member_draft.eq.true");
    expect(items[0]).toMatchObject({ kind: "story", status: "draft", memberDraft: true, publicHref: null });
  });

  // 16 Oct review: the desk's work stays the desk's. A desk-written story
  // waiting on (or sent back from) a decision isn't the member's to edit or
  // withdraw, so it isn't listed with those buttons; once published it is.
  it("lists desk-written stories only once they're published", async () => {
    const stories = queryBuilder(dbOk([], 0));
    db({ stories: () => stories });

    await memberContent("mem1");

    expect(stories.or).toHaveBeenCalledWith("source.eq.member,status.eq.published,member_draft.eq.true");
  });

  // Jas 13/10 item 12: stories led by someone else that feature this member.
  it("lists published stories featuring the member alongside its own, marked featured", async () => {
    let call = 0;
    const own = queryBuilder(dbOk([row("s1", "2026-09-02T10:00:00Z", { status: "published", slug: "own" })], 1));
    const featured = queryBuilder(dbOk([row("s9", "2026-09-01T10:00:00Z", { status: "published", slug: "joint" })], 1));
    db({ stories: () => (call++ === 0 ? own : featured) });

    const { items, total } = await memberContent("mem1", { statuses: CONTENT_FILTERS.published });

    expect(featured.eq).toHaveBeenCalledWith("story_members.member_id", "mem1");
    expect(featured.or).toHaveBeenCalledWith("member_id.is.null,member_id.neq.mem1");
    expect(items.map((i) => [i.id, Boolean(i.featured)])).toEqual([["s1", false], ["s9", true]]);
    expect(items[1]).toMatchObject({ publicHref: "/news/joint" });
    expect(total).toBe(2);
  });

  it("doesn't look for featured stories when published ones weren't asked for", async () => {
    const from = db({});
    await memberContent("mem1", { statuses: CONTENT_FILTERS.drafts });
    expect(from.mock.calls.filter(([t]) => t === "stories")).toHaveLength(1);
  });

  it("offers a preview of the member's own unpublished stories only", async () => {
    db({
      stories: () => queryBuilder(dbOk([
        row("s1", "2026-09-04T10:00:00Z", { source: "member" }),
        row("s2", "2026-09-03T10:00:00Z", { status: "draft", member_draft: true, source: "member" }),
        row("s3", "2026-09-02T10:00:00Z", { status: "published", slug: "live", source: "member" }),
        row("s4", "2026-09-01T10:00:00Z", { source: "admin" }),
      ], 4)),
    });
    const { items } = await memberContent("mem1", { statuses: CONTENT_FILTERS.all });
    const href = (id: string) => items.find((i) => i.id === id)?.previewHref;
    expect(href("s1")).toBe("/preview/story/s1");
    expect(href("s2")).toBe("/preview/story/s2");
    expect(href("s3")).toBeUndefined();
    expect(href("s4")).toBeUndefined();
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

// memberContent is what pendingSubmissions delegates to. It exists because a
// member could not see their own published work anywhere in the member area
// once it went live (fix list).
describe("memberContent", () => {
  it("queries whatever statuses it is given", async () => {
    const stories = queryBuilder(dbOk([], 0));
    db({ stories: () => stories });

    await memberContent("mem1", { statuses: CONTENT_FILTERS.published });

    expect(stories.in).toHaveBeenCalledWith("status", ["published", "scheduled"]);
  });

  it("gives a published row a public href, per kind", async () => {
    db({
      stories: () => queryBuilder(dbOk([row("s1", "2026-09-01T10:00:00Z", { status: "published", slug: "big-news" })], 1)),
      videos: () => queryBuilder(dbOk([row("v1", "2026-09-02T10:00:00Z", { status: "published", slug: "a-video" })], 1)),
      events: () => queryBuilder(dbOk([row("e1", "2026-09-03T10:00:00Z", { status: "published", slug: "open-day" })], 1)),
    });

    const { items } = await memberContent("mem1", { statuses: CONTENT_FILTERS.published });
    const href = (kind: string) => items.find((i) => i.kind === kind)?.publicHref;

    expect(href("story")).toBe("/news/big-news");
    expect(href("video")).toBe("/video/a-video");
    expect(href("event")).toBe("/event/open-day");
  });

  // /featured-machine is one page listing the current booking — an individual
  // machine has no URL of its own to send the member to.
  it("gives equipment no public href even when published", async () => {
    db({
      featured_machines: () => queryBuilder(dbOk(
        [{ id: "m1", name: "Press brake", status: "published", rejected_reason: null, created_at: "2026-09-04T10:00:00Z" }],
        1,
      )),
    });

    const { items } = await memberContent("mem1", { statuses: CONTENT_FILTERS.published });

    expect(items[0]).toMatchObject({ kind: "machine", publicHref: null });
  });

  // A draft or pending row has a slug, but that URL 404s until it publishes —
  // linking to it would be worse than not linking at all.
  it("withholds the public href until a row is actually published", async () => {
    // first stories query: the member's own; second: stories featuring them (none here)
    let call = 0;
    db({
      stories: () => call++ === 0
        ? queryBuilder(dbOk([
          row("s1", "2026-09-01T10:00:00Z", { status: "awaiting_approval", slug: "pending-news" }),
          row("s2", "2026-08-01T10:00:00Z", { status: "draft", slug: "draft-news" }),
          row("s3", "2026-07-01T10:00:00Z", { status: "scheduled", slug: "soon-news" }),
        ], 3))
        : queryBuilder(dbOk([], 0)),
    });

    const { items } = await memberContent("mem1", { statuses: CONTENT_FILTERS.all });

    expect(items.map((i) => i.publicHref)).toEqual([null, null, null]);
  });

  it("every filter maps to at least one status, and 'all' covers them all", async () => {
    for (const [name, statuses] of Object.entries(CONTENT_FILTERS)) {
      expect(statuses.length, name).toBeGreaterThan(0);
      if (name === "all") continue;
      for (const s of statuses) expect(CONTENT_FILTERS.all).toContain(s);
    }
  });

  it("isContentFilter gates the ?status= param", () => {
    expect(isContentFilter("published")).toBe(true);
    expect(isContentFilter("all")).toBe(true);
    expect(isContentFilter("bogus")).toBe(false);
    expect(isContentFilter("")).toBe(false);
  });
});

// A member submitting page changes waits on exactly the same approval as a
// story, and had no way to see it was queued (fix list).
describe("memberContent — profile revisions", () => {
  it("lists a pending page edit alongside content, with no slug of its own", async () => {
    db({
      member_revisions: () => queryBuilder(dbOk([
        { id: "r1", status: "awaiting_approval", rejected_reason: null, created_at: "2026-09-05T10:00:00Z" },
      ], 1)),
      members: () => queryBuilder(dbOk({ slug: "acme", status: "active" })),
    });

    const { items, total } = await memberContent("mem1");

    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      kind: "profile",
      title: "Changes to your company page",
      editHref: "/dashboard/profile",
      publicHref: null, // not published, so nothing live to link to
    });
  });

  it("points an applied page edit at the member's own public page", async () => {
    db({
      member_revisions: () => queryBuilder(dbOk([
        { id: "r1", status: "published", rejected_reason: null, created_at: "2026-09-05T10:00:00Z" },
      ], 1)),
      members: () => queryBuilder(dbOk({ slug: "acme", status: "active" })),
    });

    const { items } = await memberContent("mem1", { statuses: CONTENT_FILTERS.published });

    expect(items[0].publicHref).toBe("/member/acme");
  });

  // memberBySlug serves `active` and `grace` only, so a lapsed member's page is
  // a 404 however applied their revision is. Grace still has a live page.
  it("withholds the page link when the member itself is no longer public", async () => {
    const applied = () => queryBuilder(dbOk([
      { id: "r1", status: "published", rejected_reason: null, created_at: "2026-09-05T10:00:00Z" },
    ], 1));

    for (const [status, expected] of [["lapsed", null], ["grace", "/member/acme"]] as const) {
      db({ member_revisions: applied, members: () => queryBuilder(dbOk({ slug: "acme", status })) });

      const { items } = await memberContent("mem1", { statuses: CONTENT_FILTERS.published });

      expect(items[0].publicHref, status).toBe(expected);
    }
  });

  it("counts revisions in the total alongside the four content tables", async () => {
    db({
      stories: () => queryBuilder(dbOk([row("s1", "2026-09-01T10:00:00Z")], 2)),
      member_revisions: () => queryBuilder(dbOk([], 3)),
      members: () => queryBuilder(dbOk({ slug: "acme", status: "active" })),
    });

    expect((await memberContent("mem1")).total).toBe(5);
  });
});
