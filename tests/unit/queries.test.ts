import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activePlacements, activeTakeover, eventBySlug, eventsInRange, featuredMemberPlacements, featuredMembers,
  forYouStories, headlineStory, headlineVideo, ilikeTerm, industries,
  industryBySlug, memberBySlug, memberDirectory, memberFacets, memberPins, membershipTypes, mostViewedStories, newsletterBySlug,
  pastEvents, publishedStories, publishedVideos,
  searchSite, sentNewsletters, services, staticPage, storyBySlug, storyForPreview, storyMembers, storyCategories, storyIndustrySlug, storyIntros,
  upcomingEventPins, upcomingEvents,
  videoBySlug,
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

  it("filters on the story's own industry_id, with no member join", async () => {
    const storiesBuilder = queryBuilder(dbOk([{ id: "s1" }], 7));
    db({
      stories: () => storiesBuilder,
      industries: () => queryBuilder(dbOk({ id: "ind1" })),
    });

    const result = await publishedStories({ industry: "welding", limit: 12, offset: 12 });

    // the member embed must stay a LEFT join: an editorial story with an
    // industry but no member has to survive the filter (it did not before
    // migration 20260909000002, which is the point of the direct column)
    expect(storiesBuilder.select).toHaveBeenCalledWith(expect.not.stringContaining("!inner"), { count: "exact" });
    expect(storiesBuilder.eq).toHaveBeenCalledWith("industry_id", "ind1");
    expect(storiesBuilder.range).toHaveBeenCalledWith(12, 23);
    expect(result).toEqual({ stories: [{ id: "s1" }], total: 7 });
  });

  it("skips the industry filter entirely for an unknown industry slug", async () => {
    const storiesBuilder = queryBuilder(dbOk([], 0));
    db({ stories: () => storiesBuilder, industries: () => queryBuilder(dbOk(null)) });

    await publishedStories({ industry: "bogus" });

    expect(storiesBuilder.eq).not.toHaveBeenCalledWith("industry_id", expect.anything());
  });

  it("takes a pre-resolved industry id without looking the slug up again", async () => {
    const storiesBuilder = queryBuilder(dbOk([], 0));
    // no `industries` entry: fromByTable throws on an unconfigured table, so
    // this fails loudly if the id path ever regresses into a lookup. That is
    // the whole point of the option — /industry/[slug] resolves once and fans
    // the id out to four sections.
    const from = db({ stories: () => storiesBuilder });

    await publishedStories({ industry: 9 });

    expect(storiesBuilder.eq).toHaveBeenCalledWith("industry_id", 9);
    expect(from).not.toHaveBeenCalledWith("industries");
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

// Jas 13/10 item 12: a member's profile lists every story featuring them.
describe("memberBySlug — stories featuring the member", () => {
  it("reads through story_members (inner), not stories.member_id", async () => {
    const stories = queryBuilder(dbOk([]));
    db({
      members: () => queryBuilder(dbOk({ id: "m1", slug: "blm", member_membership_types: [], member_services: [] })),
      stories: () => stories,
    });
    await memberBySlug("blm");
    expect(stories.select).toHaveBeenCalledWith(expect.stringContaining("story_members!inner(member_id)"));
    expect(stories.eq).toHaveBeenCalledWith("story_members.member_id", "m1");
    expect(stories.eq).not.toHaveBeenCalledWith("member_id", "m1");
  });
});

// Luiza 15 Oct: cards, newsletters and link previews read the story_summary
// computed field (migration 20261015000004) — the author's summary, else the
// body's opening — so a story with no excerpt still has a description.
describe("story summaries", () => {
  it("story cards select the summary field under the excerpt name", async () => {
    const stories = queryBuilder(dbOk({ slug: "s" }));
    db({ stories: () => stories });
    await storyBySlug("s");
    expect(stories.select).toHaveBeenCalledWith(expect.stringContaining("excerpt:story_summary"));
  });
});

describe("storyMembers", () => {
  it("only linkable members, primary first then by name", async () => {
    db({
      story_members: () => queryBuilder(dbOk([
        { member: { id: "m3", slug: "z", name: "Zeta", logo_path: null, status: "active" } },
        { member: null },
        { member: { id: "m2", slug: "l", name: "Lapsed", logo_path: null, status: "lapsed" } },
        { member: { id: "m1", slug: "p", name: "Primary", logo_path: null, status: "active" } },
      ])),
    });
    expect((await storyMembers("s1", "m1")).map((m) => m.name)).toEqual(["Primary", "Zeta"]);
  });
});

// Jas 13/10 items 10/15: the preview reads unpublished rows, so it must be the
// service role with no status filter — and must carry what the visibility and
// permission checks need, since RLS isn't doing that work for it.
describe("storyForPreview", () => {
  it("reads by id with the service role, without the published filter", async () => {
    const stories = queryBuilder(dbOk({ id: "s1", status: "draft" }));
    const client = asDb(mockDb({ from: fromByTable({ stories: () => stories }, () => queryBuilder(dbOk(null))) }));
    vi.mocked(serviceDb).mockReturnValue(client);
    vi.mocked(publicDb).mockImplementation(() => { throw new Error("must not use publicDb"); });

    expect(await storyForPreview("s1")).toEqual({ id: "s1", status: "draft" });
    expect(stories.eq).toHaveBeenCalledWith("id", "s1");
    expect(stories.eq).not.toHaveBeenCalledWith("status", "published");
    expect(stories.select).toHaveBeenCalledWith(expect.stringMatching(/\bmember_draft\b.*\bsource\b|\bsource\b.*\bmember_draft\b/));
    expect(stories.select).toHaveBeenCalledWith(expect.stringMatching(/members!stories_member_id_fkey\([^)]*archived_at/));
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

describe("industryBySlug", () => {
  it("returns the row a /industry/[slug] page needs", async () => {
    db({ industries: () => queryBuilder(dbOk({ id: 4, slug: "welding", name: "Welding" })) });
    expect(await industryBySlug("welding")).toEqual({ id: 4, slug: "welding", name: "Welding" });
  });

  it("returns null for an unknown slug, so the page can 404", async () => {
    db({ industries: () => queryBuilder(dbOk(null)) });
    // a distinct slug per case on purpose: industryBySlug is cache()d, so
    // reusing one within a test would answer from the first call's result
    expect(await industryBySlug("bogus")).toBeNull();
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

  it("filters on industry_id, alongside the published filter rather than instead of it", async () => {
    const videosBuilder = queryBuilder(dbOk([], 0));
    db({ videos: () => videosBuilder, industries: () => queryBuilder(dbOk({ id: 3 })) });

    await publishedVideos({ industry: "welding" });

    expect(videosBuilder.eq).toHaveBeenCalledWith("status", "published");
    expect(videosBuilder.eq).toHaveBeenCalledWith("industry_id", 3);
  });

  it("skips the filter for an unknown industry slug", async () => {
    const videosBuilder = queryBuilder(dbOk([], 0));
    db({ videos: () => videosBuilder, industries: () => queryBuilder(dbOk(null)) });

    await publishedVideos({ industry: "bogus" });

    expect(videosBuilder.eq).not.toHaveBeenCalledWith("industry_id", expect.anything());
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

describe("the industry filter on the four event reads", () => {
  // All four are filtered together on purpose: /event?industry= narrows the
  // listing, the calendar grid and the map at once. Filtering only the list
  // would leave the map pinning every trade's events beside a Welding listing.
  it("narrows upcomingEvents without dropping its date bound", async () => {
    const eventsBuilder = queryBuilder(dbOk([], 0));
    db({ events: () => eventsBuilder, industries: () => queryBuilder(dbOk({ id: 5 })) });

    await upcomingEvents({ industry: "welding" });

    expect(eventsBuilder.eq).toHaveBeenCalledWith("industry_id", 5);
    expect(eventsBuilder.gte).toHaveBeenCalledWith("starts_on", expect.any(String));
  });

  it("narrows pastEvents without dropping its date bound", async () => {
    const eventsBuilder = queryBuilder(dbOk([], 0));
    db({ events: () => eventsBuilder, industries: () => queryBuilder(dbOk({ id: 5 })) });

    await pastEvents({ industry: "welding" });

    expect(eventsBuilder.eq).toHaveBeenCalledWith("industry_id", 5);
    expect(eventsBuilder.lt).toHaveBeenCalledWith("starts_on", expect.any(String));
  });

  it("narrows the calendar grid and the map pins too", async () => {
    const rangeBuilder = queryBuilder(dbOk([]));
    db({ events: () => rangeBuilder, industries: () => queryBuilder(dbOk({ id: 5 })) });
    await eventsInRange("2026-09-01", "2026-10-01", { industry: "welding" });
    expect(rangeBuilder.eq).toHaveBeenCalledWith("industry_id", 5);

    const pinsBuilder = queryBuilder(dbOk([]));
    db({ events: () => pinsBuilder, industries: () => queryBuilder(dbOk({ id: 5 })) });
    await upcomingEventPins({ industry: "welding" });
    expect(pinsBuilder.eq).toHaveBeenCalledWith("industry_id", 5);
  });

  it("leaves all four unfiltered when no industry is given", async () => {
    const eventsBuilder = queryBuilder(dbOk([], 0));
    // no `industries` entry — an unasked-for lookup would throw here
    db({ events: () => eventsBuilder });

    await upcomingEvents();
    await pastEvents();
    await eventsInRange("2026-09-01", "2026-10-01");
    await upcomingEventPins();

    expect(eventsBuilder.eq).not.toHaveBeenCalledWith("industry_id", expect.anything());
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

  // A member is in several industries (member_industries, 20261012000001), so
  // the filter goes through the join table, not the primary in industry_id.
  it("filters industries through member_industries, not the member's primary industry_id", async () => {
    const membersBuilder = queryBuilder(dbOk([], 0));
    const linksBuilder = queryBuilder(dbOk([{ member_id: "m1" }, { member_id: "m2" }, { member_id: "m1" }]));
    db({
      members: () => membersBuilder,
      industries: () => queryBuilder(dbOk([{ id: 3 }])),
      member_industries: () => linksBuilder,
    });

    await memberDirectory({ industries: ["welding-joining"] });

    expect(linksBuilder.in).toHaveBeenCalledWith("industry_id", [3]);
    expect(membersBuilder.in).toHaveBeenCalledWith("id", ["m1", "m2"]);
    expect(membersBuilder.in).not.toHaveBeenCalledWith("industry_id", expect.anything());
  });

  it("intersects industries with services, like the other axes", async () => {
    const membersBuilder = queryBuilder(dbOk([], 0));
    db({
      members: () => membersBuilder,
      industries: () => queryBuilder(dbOk([{ id: 3 }])),
      member_industries: () => queryBuilder(dbOk([{ member_id: "m1" }, { member_id: "m2" }])),
      services: () => queryBuilder(dbOk([{ id: 7 }])),
      member_services: () => queryBuilder(dbOk([{ member_id: "m2" }, { member_id: "m3" }])),
    });

    await memberDirectory({ industries: ["welding-joining"], services: ["automation-robotics"] });

    expect(membersBuilder.in).toHaveBeenCalledWith("id", ["m2"]);
  });

  it("filters to nothing when an industry slug resolves to no industry", async () => {
    const membersBuilder = queryBuilder(dbOk([], 0));
    db({ members: () => membersBuilder, industries: () => queryBuilder(dbOk([])) });

    await memberDirectory({ industries: ["welding"] });

    expect(membersBuilder.in).toHaveBeenCalledWith("id", ["00000000-0000-0000-0000-000000000000"]);
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

  it("merges the member's published stories and videos onto the record", async () => {
    db({
      members: () => queryBuilder(dbOk({ id: "m1", slug: "acme" })),
      stories: () => queryBuilder(dbOk([{ id: "s1" }])),
      videos: () => queryBuilder(dbOk([{ slug: "v1", title: "Open house", url: "https://youtu.be/x" }])),
    });

    expect(await memberBySlug("acme")).toEqual({
      id: "m1", slug: "acme", services: [], membershipTypes: [], stories: [{ id: "s1" }],
      videos: [{ slug: "v1", title: "Open house", url: "https://youtu.be/x" }],
    });
  });

  // GAPS A8.5: only this member's published videos reach their page.
  it("fetches only this member's published videos", async () => {
    const videosBuilder = queryBuilder(dbOk([]));
    db({
      members: () => queryBuilder(dbOk({ id: "m1", slug: "acme" })),
      stories: () => queryBuilder(dbOk([])),
      videos: () => videosBuilder,
    });

    await memberBySlug("acme");

    expect(videosBuilder.eq).toHaveBeenCalledWith("status", "published");
    expect(videosBuilder.eq).toHaveBeenCalledWith("member_id", "m1");
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

describe("memberFacets (GAPS A9.1)", () => {
  it("returns null without querying when nothing is filtered", async () => {
    const from = db({});
    expect(await memberFacets({})).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("assembles each visible member's industries, services and types, dropping links to members it can't see", async () => {
    const membersBuilder = queryBuilder(dbOk([{ id: "m1" }, { id: "m2" }]));
    db({
      members: () => membersBuilder,
      member_industries: () => queryBuilder(dbOk([
        { member_id: "m1", industry: { slug: "laser" } },
        { member_id: "m1", industry: { slug: "bending" } },
        { member_id: "archived", industry: { slug: "ghost-industry" } },
      ])),
      member_services: () => queryBuilder(dbOk([
        { member_id: "m1", service: { slug: "folding" } },
        { member_id: "m2", service: { slug: "welding" } },
        { member_id: "archived", service: { slug: "ghost" } },
      ])),
      member_membership_types: () => queryBuilder(dbOk([
        { member_id: "m1", type: { slug: "software" } },
        { member_id: "m2", type: { slug: "service-provider" } },
      ])),
    });

    const f = await memberFacets({ membershipTypes: ["software"] });

    expect([...f!.services]).toEqual(["folding"]);
    expect([...f!.industries].sort()).toEqual(["bending", "laser"]);
    expect(f!.services.has("ghost")).toBe(false);
    expect(f!.industries.has("ghost-industry")).toBe(false);
    // paged, so a growing join table is never truncated at max_rows
    expect(membersBuilder.range).toHaveBeenCalledWith(0, 999);
  });
});

describe("searchSite", () => {
  it("returns nothing for a term that escapes away to nothing, without querying", async () => {
    const from = db({});
    expect(await searchSite("!!!")).toEqual({ members: [], stories: [], total: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  // Members come from the search_members RPC (GAPS A9.5), which also matches
  // services and industry; stories still use their own search_tsv.
  function withRpc(map: Record<string, () => ReturnType<typeof queryBuilder>>, members: unknown[]) {
    const from = fromByTable(map, () => queryBuilder(dbOk(null)));
    const rpc = vi.fn(async () => dbOk(members));
    const client = asDb(mockDb({ from, rpc }));
    vi.mocked(publicDb).mockReturnValue(client);
    return { from, rpc };
  }

  it("searches both members and stories, ranking members conceptually first in the shape returned", async () => {
    withRpc({ stories: () => queryBuilder(dbOk([{ id: "s1" }], 1)) }, [{ slug: "acme" }]);

    expect(await searchSite("acme")).toEqual({ members: [{ slug: "acme" }], stories: [{ id: "s1" }], total: 1 });
  });

  it("hands search_members the same escaped tsquery the story search uses", async () => {
    const { rpc } = withRpc({ stories: () => queryBuilder(dbOk([], 0)) }, []);

    await searchSite("laser  cutting's");

    expect(rpc).toHaveBeenCalledWith("search_members", { query: "laser & cutting & s", max_results: 10 });
  });

  it("returns no members rather than throwing when the RPC errors", async () => {
    const from = fromByTable({ stories: () => queryBuilder(dbOk([], 0)) }, () => queryBuilder(dbOk(null)));
    const rpc = vi.fn(async () => ({ data: null, error: { message: "syntax error in tsquery" } }));
    vi.mocked(publicDb).mockReturnValue(asDb(mockDb({ from, rpc })));

    expect((await searchSite("acme")).members).toEqual([]);
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

/* ---------- vocabularies ---------- */

describe("services / membershipTypes", () => {
  it("return their rows", async () => {
    db({ services: () => queryBuilder(dbOk([{ slug: "welding", name: "Welding" }])) });
    expect(await services()).toEqual([{ slug: "welding", name: "Welding" }]);

    db({ membership_types: () => queryBuilder(dbOk([{ slug: "software", name: "Software" }])) });
    expect(await membershipTypes()).toEqual([{ slug: "software", name: "Software" }]);
  });

  it("return [] rather than null when the read fails, so a filter dropdown still renders", async () => {
    db({ services: () => queryBuilder(dbOk(null)) });
    expect(await services()).toEqual([]);

    db({ membership_types: () => queryBuilder(dbOk(null)) });
    expect(await membershipTypes()).toEqual([]);
  });
});

/* ---------- storyIndustrySlug ---------- */

describe("storyIndustrySlug", () => {
  it("makes no query at all for a missing id", async () => {
    const from = db({});
    expect(await storyIndustrySlug(null)).toBeNull();
    expect(await storyIndustrySlug(undefined)).toBeNull();
    expect(await storyIndustrySlug("")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  // PostgREST returns a to-one embed as an object, but the generated types (and
  // some client versions) surface it as a one-element array. Both shapes have
  // to work or the industry silently disappears from a story page.
  it("reads the slug when the embed is an object", async () => {
    db({ stories: () => queryBuilder(dbOk({ industry: { slug: "welding" } })) });
    expect(await storyIndustrySlug("s1")).toBe("welding");
  });

  it("reads the slug when the embed is an array", async () => {
    db({ stories: () => queryBuilder(dbOk({ industry: [{ slug: "laser-cutting" }] })) });
    expect(await storyIndustrySlug("s1")).toBe("laser-cutting");
  });

  it("is null for a story with no industry, an empty array, or no row", async () => {
    db({ stories: () => queryBuilder(dbOk({ industry: null })) });
    expect(await storyIndustrySlug("s1")).toBeNull();

    db({ stories: () => queryBuilder(dbOk({ industry: [] })) });
    expect(await storyIndustrySlug("s1")).toBeNull();

    db({ stories: () => queryBuilder(dbOk(null)) });
    expect(await storyIndustrySlug("s1")).toBeNull();
  });
});

/* ---------- mostViewedStories ---------- */

describe("mostViewedStories", () => {
  it("sums a story's views across days and ranks by the total", async () => {
    db({
      // s2 wins on the total (5+5) despite s1 having the single biggest day.
      rollups_daily: () => queryBuilder(dbOk([
        { story_id: "s1", count: 9 },
        { story_id: "s2", count: 5 },
        { story_id: "s2", count: 5 },
      ])),
      stories: () => queryBuilder(dbOk([{ id: "s1" }, { id: "s2" }])),
    });
    expect((await mostViewedStories()).map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("returns the cards in rank order even though the fetch comes back arbitrarily", async () => {
    db({
      rollups_daily: () => queryBuilder(dbOk([{ story_id: "s1", count: 1 }, { story_id: "s2", count: 99 }])),
      // Deliberately the wrong order — an `in()` result has no ordering guarantee.
      stories: () => queryBuilder(dbOk([{ id: "s1" }, { id: "s2" }])),
    });
    expect((await mostViewedStories()).map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("drops excluded ids before ranking, so a rail never repeats what is above it", async () => {
    db({
      rollups_daily: () => queryBuilder(dbOk([{ story_id: "s1", count: 99 }, { story_id: "s2", count: 1 }])),
      stories: () => queryBuilder(dbOk([{ id: "s2" }])),
    });
    expect((await mostViewedStories({ excludeIds: ["s1"] })).map((s) => s.id)).toEqual(["s2"]);
  });

  it("ignores rollup rows with no story_id", async () => {
    db({
      rollups_daily: () => queryBuilder(dbOk([{ story_id: null, count: 99 }, { story_id: "s1", count: 1 }])),
      stories: () => queryBuilder(dbOk([{ id: "s1" }])),
    });
    expect((await mostViewedStories()).map((s) => s.id)).toEqual(["s1"]);
  });

  it("applies the limit to the ranked ids", async () => {
    db({
      rollups_daily: () => queryBuilder(dbOk([
        { story_id: "s1", count: 3 }, { story_id: "s2", count: 2 }, { story_id: "s3", count: 1 },
      ])),
      stories: () => queryBuilder(dbOk([{ id: "s1" }, { id: "s2" }])),
    });
    expect((await mostViewedStories({ limit: 2 })).map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("skips the card fetch entirely when nothing qualifies", async () => {
    const from = db({ rollups_daily: () => queryBuilder(dbOk([])) });
    expect(await mostViewedStories()).toEqual([]);
    expect(from).not.toHaveBeenCalledWith("stories");
  });

  it("survives a null rollups read", async () => {
    db({ rollups_daily: () => queryBuilder(dbOk(null)) });
    expect(await mostViewedStories()).toEqual([]);
  });
});

/* ---------- forYouStories ---------- */

describe("forYouStories", () => {
  it("makes no query for an empty slug list", async () => {
    const from = db({});
    expect(await forYouStories([])).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns [] when no slug matches either vocabulary", async () => {
    // The cookie stores bare slugs with no marker of which list they came from,
    // so both are looked up and a miss on both means nothing to show.
    const from = db({
      categories: () => queryBuilder(dbOk([])),
      industries: () => queryBuilder(dbOk([])),
    });
    expect(await forYouStories(["nonsense"])).toEqual([]);
    expect(from).not.toHaveBeenCalledWith("stories");
  });

  it("queries stories once a category slug resolves", async () => {
    const from = db({
      categories: () => queryBuilder(dbOk([{ id: 3 }])),
      industries: () => queryBuilder(dbOk([])),
      stories: () => queryBuilder(dbOk([{ id: "s1" }])),
    });
    expect((await forYouStories(["welding"])).map((s) => s.id)).toEqual(["s1"]);
    expect(from).toHaveBeenCalledWith("stories");
  });

  it("de-duplicates a story matched by both its topic and its industry", async () => {
    db({
      categories: () => queryBuilder(dbOk([{ id: 3 }])),
      industries: () => queryBuilder(dbOk([{ id: 7 }])),
      stories: () => queryBuilder(dbOk([{ id: "s1" }])),
    });
    expect((await forYouStories(["welding"])).map((s) => s.id)).toEqual(["s1"]);
  });
});

/* ---------- featured members ---------- */

describe("featuredMemberPlacements", () => {
  it("keeps only featured_member placements", () => {
    const placements = [
      { kind: "featured_member", member: { slug: "a" } },
      { kind: "takeover", member: null },
      { kind: "featured_machine", member: { slug: "b" } },
    ] as unknown as Awaited<ReturnType<typeof activePlacements>>;
    expect(featuredMemberPlacements(placements).map((p) => p.kind)).toEqual(["featured_member"]);
  });

  it("is [] when none are featured members", () => {
    const placements = [{ kind: "takeover" }] as unknown as Awaited<ReturnType<typeof activePlacements>>;
    expect(featuredMemberPlacements(placements)).toEqual([]);
  });
});

describe("featuredMembers", () => {
  it("filters what activePlacements returns", async () => {
    db({
      placements: () => queryBuilder(dbOk([
        { kind: "featured_member", member: { slug: "a", status: "active", archived_at: null } },
        { kind: "takeover", member: null },
      ])),
    });
    expect((await featuredMembers()).map((p) => p.kind)).toEqual(["featured_member"]);
  });
});

/* ---------- memberPins ---------- */

describe("memberPins", () => {
  it("returns the pins with a total", async () => {
    db({ members: () => queryBuilder(dbOk([{ slug: "acme", name: "Acme", lat: 52.4, lng: -1.7 }], 1)) });
    expect(await memberPins()).toEqual({
      members: [{ slug: "acme", name: "Acme", lat: 52.4, lng: -1.7 }],
      total: 1,
    });
  });

  it("short-circuits a search term that sanitises to nothing", async () => {
    // Otherwise a punctuation-only query would match the whole directory.
    const from = db({});
    expect(await memberPins({ q: "%%%" })).toEqual({ members: [], total: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  it("is empty rather than null when the read fails", async () => {
    db({ members: () => queryBuilder(dbOk(null, null)) });
    expect(await memberPins()).toEqual({ members: [], total: 0 });
  });

  it("filters industries through member_industries, the same as the directory beside it", async () => {
    const membersBuilder = queryBuilder(dbOk([], 0));
    db({
      members: () => membersBuilder,
      industries: () => queryBuilder(dbOk([{ id: 3 }])),
      member_industries: () => queryBuilder(dbOk([{ member_id: "m1" }])),
    });

    await memberPins({ industries: ["welding-joining"] });

    expect(membersBuilder.in).toHaveBeenCalledWith("id", ["m1"]);
    expect(membersBuilder.in).not.toHaveBeenCalledWith("industry_id", expect.anything());
  });
});
