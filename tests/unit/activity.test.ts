import { afterEach, describe, expect, it, vi } from "vitest";
import { memberActivityTimeline } from "@/lib/activity";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder, sequence } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

/**
 * The renewal-call timeline (A18), shared by the console member editor and the
 * CRM contact panel. It was at 0% coverage — which matters because it is six
 * queries merged by hand, and the merge is the part that can go wrong silently:
 * a mis-sorted or truncated timeline still renders, it just tells Jas the wrong
 * story on a renewal call.
 */
const MEMBER = "11111111-1111-1111-1111-111111111111";

/** Routes .from(table) for the seven tables the timeline touches. */
function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk([])));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("memberActivityTimeline", () => {
  it("merges every source and sorts newest first", async () => {
    db({
      // Queried twice: the titled page, then every id for the newsletter lookup.
      stories: sequence<unknown>(
        dbOk([{ title: "New laser cell", published_at: "2026-03-01", member_id: MEMBER }]),
        dbOk([{ id: "s1" }]),
      ),
      placements: () => queryBuilder(dbOk([{ kind: "featured_member", starts_on: "2026-05-01" }])),
      invoices: () => queryBuilder(dbOk([{ number: "INV-9", issued_on: "2026-01-15", status: "paid" }])),
      notifications: () => queryBuilder(dbOk([{ kind: "stats_digest", created_at: "2026-04-01" }])),
      adverts: () => queryBuilder(dbOk([{ id: "a1", name: "Spring banner" }])),
      analytics_events: () => queryBuilder(dbOk([{ occurred_at: "2026-06-01", advert_id: "a1" }])),
      newsletter_items: () => queryBuilder(dbOk([{ issue: { number: 7, sent_at: "2026-02-01", status: "sent" } }])),
    });

    const timeline = await memberActivityTimeline(MEMBER);

    expect(timeline.map((e) => e.when)).toEqual([
      "2026-06-01", "2026-05-01", "2026-04-01", "2026-03-01", "2026-02-01", "2026-01-15",
    ]);
    expect(timeline.map((e) => e.what)).toEqual([
      "Advert clicked: Spring banner",
      "Placement: featured member",
      "Notified: stats_digest",
      "Story published: New laser cell",
      "Featured in newsletter issue 7",
      "Invoice INV-9 (paid)",
    ]);
  });

  // Jas 13/10 item 12: a story led by another member that also features this one.
  it("reads stories through story_members, and says when the member was featured rather than the lead", async () => {
    const stories = queryBuilder(dbOk([
      { title: "Own news", published_at: "2026-03-02", member_id: MEMBER },
      { title: "Joint show", published_at: "2026-03-01", member_id: "someone-else" },
    ]));
    db({ stories: () => stories });

    const timeline = await memberActivityTimeline(MEMBER);

    expect(stories.eq).toHaveBeenCalledWith("story_members.member_id", MEMBER);
    expect(timeline.map((e) => e.what)).toEqual(["Story published: Own news", "Featured in story: Joint show"]);
  });

  it("underscores in a placement kind become spaces", async () => {
    db({
      stories: sequence<unknown>(dbOk([]), dbOk([])),
      placements: () => queryBuilder(dbOk([{ kind: "featured_machine", starts_on: "2026-05-01" }])),
      invoices: () => queryBuilder(dbOk([])),
      notifications: () => queryBuilder(dbOk([])),
      adverts: () => queryBuilder(dbOk([])),
    });
    const [entry] = await memberActivityTimeline(MEMBER);
    expect(entry.what).toBe("Placement: featured machine");
  });

  it("skips the click and newsletter queries when there are no adverts or stories", async () => {
    const from = db({
      stories: sequence<unknown>(dbOk([]), dbOk([])),
      placements: () => queryBuilder(dbOk([])),
      invoices: () => queryBuilder(dbOk([])),
      notifications: () => queryBuilder(dbOk([])),
      adverts: () => queryBuilder(dbOk([])),
    });

    await expect(memberActivityTimeline(MEMBER)).resolves.toEqual([]);

    // The guard is the point: a member with no adverts must not query
    // analytics_events, which is the partitioned table.
    const tables = from.mock.calls.map(([t]) => t);
    expect(tables).not.toContain("analytics_events");
    expect(tables).not.toContain("newsletter_items");
  });

  it("falls back to 'advert' when a click's advert_id resolves to no name", async () => {
    db({
      stories: sequence<unknown>(dbOk([]), dbOk([])),
      placements: () => queryBuilder(dbOk([])),
      invoices: () => queryBuilder(dbOk([])),
      notifications: () => queryBuilder(dbOk([])),
      adverts: () => queryBuilder(dbOk([{ id: "a1", name: "Known" }])),
      // analytics_events carries no FK to adverts, so an id can outlive its row.
      analytics_events: () => queryBuilder(dbOk([{ occurred_at: "2026-06-01", advert_id: "gone" }])),
    });
    const [entry] = await memberActivityTimeline(MEMBER);
    expect(entry.what).toBe("Advert clicked: advert");
  });

  it("tolerates a null advert_id on a click row", async () => {
    db({
      stories: sequence<unknown>(dbOk([]), dbOk([])),
      placements: () => queryBuilder(dbOk([])),
      invoices: () => queryBuilder(dbOk([])),
      notifications: () => queryBuilder(dbOk([])),
      adverts: () => queryBuilder(dbOk([{ id: "a1", name: "Known" }])),
      analytics_events: () => queryBuilder(dbOk([{ occurred_at: "2026-06-01", advert_id: null }])),
    });
    const [entry] = await memberActivityTimeline(MEMBER);
    expect(entry.what).toBe("Advert clicked: advert");
  });

  it("sorts a null published_at last rather than throwing", async () => {
    db({
      stories: sequence<unknown>(
        dbOk([{ title: "Undated", published_at: null, member_id: MEMBER }, { title: "Dated", published_at: "2026-03-01", member_id: MEMBER }]),
        dbOk([]),
      ),
      placements: () => queryBuilder(dbOk([])),
      invoices: () => queryBuilder(dbOk([])),
      notifications: () => queryBuilder(dbOk([])),
      adverts: () => queryBuilder(dbOk([])),
    });
    const timeline = await memberActivityTimeline(MEMBER);
    expect(timeline.map((e) => e.what)).toEqual(["Story published: Dated", "Story published: Undated"]);
  });

  it("applies the limit after merging, not per source", async () => {
    db({
      stories: sequence<unknown>(
        dbOk([{ title: "A", published_at: "2026-03-01" }]),
        dbOk([]),
      ),
      placements: () => queryBuilder(dbOk([{ kind: "takeover", starts_on: "2026-05-01" }])),
      invoices: () => queryBuilder(dbOk([{ number: "INV-1", issued_on: "2026-01-01", status: "paid" }])),
      notifications: () => queryBuilder(dbOk([])),
      adverts: () => queryBuilder(dbOk([])),
    });
    const timeline = await memberActivityTimeline(MEMBER, 2);
    expect(timeline).toHaveLength(2);
    expect(timeline[0].when).toBe("2026-05-01");
  });

  it("returns [] when every source is null", async () => {
    db({
      stories: sequence<unknown>(dbOk(null), dbOk(null)),
      placements: () => queryBuilder(dbOk(null)),
      invoices: () => queryBuilder(dbOk(null)),
      notifications: () => queryBuilder(dbOk(null)),
      adverts: () => queryBuilder(dbOk(null)),
    });
    await expect(memberActivityTimeline(MEMBER)).resolves.toEqual([]);
  });
});
