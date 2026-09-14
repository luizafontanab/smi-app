import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activePlacements, activeTakeover, eventBySlug, headlineStory, headlineVideo, ilikeTerm, industries, memberBySlug,
  memberDirectory, newsletterBySlug, pastEvents, publishedStories, publishedVideos, searchSite, sentNewsletters, staticPage,
  storiesByIndustry, storyBySlug, storyCategories, storyIntros, upcomingEvents, videoBySlug,
} from "@/lib/queries";
import { publicDb, serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

/** Wires publicDb()/serviceDb() to the same table-routed fake — queries.ts never mixes the two within one call. */
function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  const client = asDb(mockDb({ from }));
  vi.mocked(publicDb).mockReturnValue(client);
  vi.mocked(serviceDb).mockReturnValue(client);
  return from;
}

describe("publishedStories", () => {
  it("returns the rows and total count as-is", async () => {
    db({ stories: () => queryBuilder(dbOk([{ id: "s1" }], 42)) });

    const result = await publishedStories();

    expect(result).toEqual({ stories: [{ id: "s1" }], total: 42 });
  });

  it("filters to member news when memberOnly is set", async () => {
    const storiesBuilder = queryBuilder(dbOk([], 0));
    db({ stories: () => storiesBuilder });

    await publishedStories({ memberOnly: true });

    expect(storiesBuilder.eq).toHaveBeenCalledWith("is_member_news", true);
  });

  it("resolves a category and filters through the link-table inner join", async () => {
    const storiesBuilder = queryBuilder(dbOk([], 0));
    db({
      stories: () => storiesBuilder,
      categories: () => queryBuilder(dbOk({ id: "cat1" })),
    });

    await publishedStories({ category: "fabrication" });

    // inner join, not a pre-fetched id list — the old `.in("id", [...])` pulled
    // every story_categories row for the category first
    expect(storiesBuilder.select).toHaveBeenCalledWith(expect.stringContaining("story_categories!inner"), { count: "exact" });
    expect(storiesBuilder.eq).toHaveBeenCalledWith("story_categories.category_id", "cat1");
  });

  it("skips the category filter entirely for an unknown category slug", async () => {
    const storiesBuilder = queryBuilder(dbOk([], 0));
    db({ stories: () => storiesBuilder, categories: () => queryBuilder(dbOk(null)) });

    await publishedStories({ category: "bogus" });

    expect(storiesBuilder.select).toHaveBeenCalledWith(expect.not.stringContaining("story_categories"), { count: "exact" });
    expect(storiesBuilder.eq).not.toHaveBeenCalledWith("story_categories.category_id", expect.anything());
  });
});

describe("headlineStory", () => {
  it("prefers a pinned story over the latest published one", async () => {
    db({ stories: () => queryBuilder(dbOk([{ id: "pinned" }], 1)) });

    expect(await headlineStory()).toEqual({ id: "pinned" });
  });

  it("falls back to the latest published story when nothing is pinned", async () => {
    let call = 0;
    db({
      stories: () => queryBuilder(() => (call++ === 0 ? dbOk([]) : dbOk([{ id: "latest" }], 1))),
    });

    expect(await headlineStory()).toEqual({ id: "latest" });
  });

  it("returns null on a site with no published stories at all", async () => {
    db({ stories: () => queryBuilder(dbOk([], 0)) });

    expect(await headlineStory()).toBeNull();
  });
});

describe("storyBySlug / videoBySlug / eventBySlug / staticPage", () => {
  it("return the row directly, or null on a miss", async () => {
    db({ stories: () => queryBuilder(dbOk({ slug: "acme-story" })) });
    expect(await storyBySlug("acme-story")).toEqual({ slug: "acme-story" });

    db({ videos: () => queryBuilder(dbOk(null)) });
    expect(await videoBySlug("missing")).toBeNull();

    db({ static_pages: () => queryBuilder(dbOk(null)) });
    expect(await staticPage("missing")).toBeNull();
  });
});

describe("storyIntros", () => {
  it("returns an empty map without querying for no ids", async () => {
    const from = db({});
    expect(await storyIntros([])).toEqual(new Map());
    expect(from).not.toHaveBeenCalled();
  });

  it("maps id to body", async () => {
    db({ stories: () => queryBuilder(dbOk([{ id: "s1", body: "<p>Hi</p>" }, { id: "s2", body: null }])) });

    expect(await storyIntros(["s1", "s2"])).toEqual(new Map([["s1", "<p>Hi</p>"], ["s2", null]]));
  });
});

describe("storyCategories / activePlacements / sentNewsletters", () => {
  it("default to an empty list rather than null", async () => {
    db({ categories: () => queryBuilder(dbOk(null)) });
    expect(await storyCategories()).toEqual([]);

    db({ placements: () => queryBuilder(dbOk(null)) });
    expect(await activePlacements()).toEqual([]);

    db({ newsletter_issues: () => queryBuilder(dbOk(null)) });
    expect(await sentNewsletters()).toEqual([]);
  });
});

describe("industries", () => {
  it("fetches the industry list in its curated order, defaulting to an empty list", async () => {
    const indBuilder = queryBuilder(dbOk([{ slug: "welding", name: "Welding" }]));
    db({ industries: () => indBuilder });
    expect(await industries()).toEqual([{ slug: "welding", name: "Welding" }]);
    // sort_order, not name: the strip's order is editorial, set in the console
    expect(indBuilder.order).toHaveBeenCalledWith("sort_order");

    db({ industries: () => queryBuilder(dbOk(null)) });
    expect(await industries()).toEqual([]);
  });
});

describe("storiesByIndustry", () => {
  it("returns null for an unknown slug without querying stories", async () => {
    const from = db({ industries: () => queryBuilder(dbOk(null)) });
    expect(await storiesByIndustry("bogus")).toBeNull();
    expect(from).not.toHaveBeenCalledWith("stories");
  });

  it("filters on the story's own industry_id, with no member join", async () => {
    const storiesBuilder = queryBuilder(dbOk([{ id: "s1" }], 7));
    db({
      stories: () => storiesBuilder,
      industries: () => queryBuilder(dbOk({ id: "ind1", slug: "welding", name: "Welding" })),
    });

    const result = await storiesByIndustry("welding", { limit: 12, offset: 12 });

    // the member embed must stay a LEFT join: an editorial story with an
    // industry but no member has to survive the filter (it did not before
    // migration 20260909000002, which is the point of the direct column)
    expect(storiesBuilder.select).toHaveBeenCalledWith(expect.not.stringContaining("!inner"), { count: "exact" });
    expect(storiesBuilder.eq).toHaveBeenCalledWith("industry_id", "ind1");
    expect(storiesBuilder.range).toHaveBeenCalledWith(12, 23);
    expect(result).toEqual({ industry: { slug: "welding", name: "Welding" }, stories: [{ id: "s1" }], total: 7 });
  });
});

describe("activeTakeover", () => {
  it("returns null when the live placement has no complete config", async () => {
    db({ placements: () => queryBuilder(dbOk({ config: { hex: "#fff" }, member: null })) }); // missing banner_path
    expect(await activeTakeover()).toBeNull();
  });

  it("returns null when there is no live takeover at all", async () => {
    db({ placements: () => queryBuilder(dbOk(null)) });
    expect(await activeTakeover()).toBeNull();
  });

  it("returns the takeover with its member slug when fully configured", async () => {
    db({ placements: () => queryBuilder(dbOk({ config: { hex: "#112233", banner_path: "b.jpg" }, member: { slug: "acme" } })) });

    expect(await activeTakeover()).toEqual({ hex: "#112233", bannerPath: "b.jpg", memberSlug: "acme" });
  });
});

describe("publishedVideos", () => {
  it("returns rows and total, defaulting an empty result to []", async () => {
    db({ videos: () => queryBuilder(dbOk(null, 0)) });
    expect(await publishedVideos()).toEqual({ videos: [], total: 0 });
  });
});

describe("headlineVideo", () => {
  it("returns the pinned video when one exists", async () => {
    db({ videos: () => queryBuilder(dbOk([{ id: "pinned" }], 1)) });
    expect(await headlineVideo()).toEqual({ id: "pinned" });
  });

  it("returns null when nothing is pinned — no fallback to latest", async () => {
    db({ videos: () => queryBuilder(dbOk([], 0)) });
    expect(await headlineVideo()).toBeNull();
  });
});

describe("upcomingEvents / pastEvents / eventBySlug — location repair", () => {
  it("repairs the location field on every row via displayLocation", async () => {
    db({ events: () => queryBuilder(dbOk([{ slug: "e1", location: "London" }], 1)) });
    const { events } = await upcomingEvents();
    expect(events[0].location).toBe("London"); // plain text passes through unchanged

    db({ events: () => queryBuilder(dbOk([{ slug: "e2", location: null }], 1)) });
    const past = await pastEvents();
    expect(past.events[0].location).toBeNull();

    db({ events: () => queryBuilder(dbOk({ slug: "e3", location: "Leeds" })) });
    expect((await eventBySlug("e3"))!.location).toBe("Leeds");
  });

  it("eventBySlug returns null on a miss without touching displayLocation's row-list shape", async () => {
    db({ events: () => queryBuilder(dbOk(null)) });
    expect(await eventBySlug("missing")).toBeNull();
  });
});

describe("ilikeTerm", () => {
  it("strips PostgREST-meaningful and ILIKE wildcard characters", () => {
    expect(ilikeTerm("a,id.not.is.null")).toBe("a id.not.is.null");
    expect(ilikeTerm("50% off (deal)")).toBe("50 off deal");
    expect(ilikeTerm("under_score*star")).toBe("under score star");
  });

  it("collapses whitespace and trims", () => {
    expect(ilikeTerm("  Acme    Ltd  ")).toBe("Acme Ltd");
  });

  it("keeps apostrophes, ampersands, dots and colons — real member-name characters", () => {
    expect(ilikeTerm("O'Brien & Sons Ltd. (co.uk)")).toBe("O'Brien & Sons Ltd. co.uk");
  });

  it("truncates to 80 characters", () => {
    expect(ilikeTerm("x".repeat(200)).length).toBe(80);
  });
});

describe("memberDirectory", () => {
  it("returns nothing for a query that sanitises away to nothing, without querying", async () => {
    const from = db({});
    expect(await memberDirectory({ q: "%%%" })).toEqual({ members: [], total: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  it("applies an OR filter across name and description for a real term", async () => {
    const membersBuilder = queryBuilder(dbOk([], 0));
    db({ members: () => membersBuilder });

    await memberDirectory({ q: "fabrication" });

    expect(membersBuilder.or).toHaveBeenCalledWith("name.ilike.%fabrication%,description.ilike.%fabrication%");
  });

  it("resolves industry slugs and filters by their ids", async () => {
    const membersBuilder = queryBuilder(dbOk([], 0));
    db({ members: () => membersBuilder, industries: () => queryBuilder(dbOk([{ id: "ind1" }])) });

    await memberDirectory({ industries: ["fabrication"] });

    expect(membersBuilder.in).toHaveBeenCalledWith("industry_id", ["ind1"]);
  });

  it("filters services through member_services, not membership_types", async () => {
    const membersBuilder = queryBuilder(dbOk([], 0));
    db({
      members: () => membersBuilder,
      services: () => queryBuilder(dbOk([{ id: 7 }])),
      member_services: () => queryBuilder(dbOk([{ member_id: "m1" }])),
    });

    await memberDirectory({ services: ["automation-robotics"] });

    expect(membersBuilder.in).toHaveBeenCalledWith("id", ["m1"]);
  });

  it("intersects services and membership types so both narrow the result", async () => {
    const membersBuilder = queryBuilder(dbOk([], 0));
    db({
      members: () => membersBuilder,
      services: () => queryBuilder(dbOk([{ id: 7 }])),
      member_services: () => queryBuilder(dbOk([{ member_id: "m1" }, { member_id: "m2" }])),
      membership_types: () => queryBuilder(dbOk([{ id: 2 }])),
      member_membership_types: () => queryBuilder(dbOk([{ member_id: "m2" }, { member_id: "m3" }])),
    });

    await memberDirectory({ services: ["automation-robotics"], membershipTypes: ["equipment-supplier"] });

    expect(membersBuilder.in).toHaveBeenCalledWith("id", ["m2"]);
  });

  it("fetches the whole set (no SQL range) and slices offset/limit in JS after the seeded shuffle", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, name: `Member ${i}` }));

    // No limit: the whole filtered set comes back (homepage logo wall).
    const whole = queryBuilder(dbOk(rows, rows.length));
    db({ members: () => whole });
    expect((await memberDirectory({})).members).toHaveLength(10);
    expect(whole.range).not.toHaveBeenCalled();

    // Pagination happens in JS — no .range even with a limit.
    const paged = queryBuilder(dbOk(rows, rows.length));
    db({ members: () => paged });
    const page1 = await memberDirectory({ limit: 4, offset: 0 });
    expect(paged.range).not.toHaveBeenCalled();
    expect(page1.members).toHaveLength(4);
    expect(page1.total).toBe(10);
  });

  it("orders by a day-stable seeded shuffle, so pages tile the set without repeats or gaps", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, name: `Member ${i}` }));
    const pageOf = async (offset: number) => {
      db({ members: () => queryBuilder(dbOk(rows, rows.length)) });
      return (await memberDirectory({ limit: 4, offset })).members.map((m) => m.id as string);
    };

    const [p1, p2, p3] = [await pageOf(0), await pageOf(4), await pageOf(8)];

    // Same request repeated (same UTC day + filters) → identical order …
    expect(await pageOf(0)).toEqual(p1);
    // … and consecutive pages partition the full set: every member exactly once.
    const ids = [...p1, ...p2, ...p3];
    expect(ids).toHaveLength(10);
    expect([...ids].sort()).toEqual(rows.map((r) => r.id).sort());
  });
});

describe("memberBySlug", () => {
  it("returns null without querying stories when the member doesn't exist", async () => {
    const from = db({ members: () => queryBuilder(dbOk(null)) });
    expect(await memberBySlug("missing")).toBeNull();
    expect(from).not.toHaveBeenCalledWith("stories");
  });

  it("merges the member's published stories onto the record", async () => {
    db({
      members: () => queryBuilder(dbOk({ id: "m1", slug: "acme" })),
      stories: () => queryBuilder(dbOk([{ id: "s1" }])),
    });

    expect(await memberBySlug("acme")).toEqual({
      id: "m1", slug: "acme", services: [], membershipTypes: [], stories: [{ id: "s1" }],
    });
  });

  it("flattens the two taxonomy joins into separate lists — they are different things", async () => {
    db({
      members: () => queryBuilder(dbOk({
        id: "m1",
        slug: "acme",
        member_membership_types: [
          { membership_type: { slug: "software", name: "Software" } },
          { membership_type: { slug: "it-services", name: "IT Services" } },
          { membership_type: null }, // a dangling join row must not crash the flatten
        ],
        member_services: [
          { service: { slug: "automation-robotics", name: "Automation / Robotics" } },
          { service: null },
        ],
      })),
      stories: () => queryBuilder(dbOk([])),
    });

    const member = await memberBySlug("acme");
    // Membership types used to be returned under the name `services`, which is
    // what made the directory's "Services" filter show the 5-item type list.
    expect(member?.membershipTypes).toEqual([
      { slug: "software", name: "Software" },
      { slug: "it-services", name: "IT Services" },
    ]);
    expect(member?.services).toEqual([{ slug: "automation-robotics", name: "Automation / Robotics" }]);
  });
});

describe("searchSite", () => {
  it("returns nothing for a term that escapes away to nothing, without querying", async () => {
    const from = db({});
    expect(await searchSite("!!!")).toEqual({ members: [], stories: [], total: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  it("searches both members and stories, ranking members conceptually first in the shape returned", async () => {
    db({
      members: () => queryBuilder(dbOk([{ slug: "acme" }])),
      stories: () => queryBuilder(dbOk([{ id: "s1" }], 1)),
    });

    expect(await searchSite("acme")).toEqual({ members: [{ slug: "acme" }], stories: [{ id: "s1" }], total: 1 });
  });

  it("filters stories to member news when memberOnly is set", async () => {
    const storiesBuilder = queryBuilder(dbOk([], 0));
    db({ members: () => queryBuilder(dbOk([])), stories: () => storiesBuilder });

    await searchSite("acme", { memberOnly: true });

    expect(storiesBuilder.eq).toHaveBeenCalledWith("is_member_news", true);
  });
});

describe("newsletterBySlug", () => {
  it("returns null without fetching items when the issue doesn't exist", async () => {
    const from = db({ newsletter_issues: () => queryBuilder(dbOk(null)) });
    expect(await newsletterBySlug("missing")).toBeNull();
    expect(from).not.toHaveBeenCalledWith("newsletter_items");
  });

  it("merges the issue's items in position order", async () => {
    db({
      newsletter_issues: () => queryBuilder(dbOk({ id: "iss1", number: 4 })),
      newsletter_items: () => queryBuilder(dbOk([{ position: 1, story: { slug: "s1" } }])),
    });

    expect(await newsletterBySlug("aug-2026")).toEqual({ id: "iss1", number: 4, items: [{ position: 1, story: { slug: "s1" } }] });
  });
});
