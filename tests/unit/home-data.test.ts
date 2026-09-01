import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { excluding, loadHome } from "@/app/(public)/home.data";

type Rec = Record<string, unknown>;

const {
  headlineStory, publishedStories, publishedVideos, upcomingEvents, activePlacements, liveAdvertsByFormat,
  sentNewsletters, memberDirectory, storyCategories, showAdPlaceholders, storyIntros, requestContext, record,
} = vi.hoisted(() => ({
  headlineStory: vi.fn<() => Promise<Rec | null>>(async () => null),
  publishedStories: vi.fn<() => Promise<{ stories: Rec[]; total: number }>>(async () => ({ stories: [], total: 0 })),
  publishedVideos: vi.fn<() => Promise<{ videos: Rec[]; total: number }>>(async () => ({ videos: [], total: 0 })),
  upcomingEvents: vi.fn<() => Promise<{ events: Rec[]; total: number }>>(async () => ({ events: [], total: 0 })),
  activePlacements: vi.fn<() => Promise<Rec[]>>(async () => []),
  liveAdvertsByFormat: vi.fn<() => Promise<Rec>>(async () => ({})),
  sentNewsletters: vi.fn<() => Promise<Rec[]>>(async () => []),
  memberDirectory: vi.fn<() => Promise<{ members: Rec[]; total: number }>>(async () => ({ members: [], total: 0 })),
  storyCategories: vi.fn<() => Promise<Rec[]>>(async () => []),
  showAdPlaceholders: vi.fn<() => Promise<boolean>>(async () => false),
  storyIntros: vi.fn<() => Promise<Map<string, string | null>>>(async () => new Map()),
  requestContext: vi.fn(async () => ({ session_hash: null as string | null, referrer: null as string | null, region: null as string | null, company: null as string | null, consented: false })),
  record: vi.fn(() => {}),
}));
vi.mock("@/lib/queries", () => ({
  headlineStory, publishedStories, publishedVideos, upcomingEvents, activePlacements, sentNewsletters,
  memberDirectory, storyCategories, storyIntros,
}));
vi.mock("@/lib/adverts", () => ({ liveAdvertsByFormat, showAdPlaceholders }));
vi.mock("@/lib/analytics", () => ({ requestContext, record }));

beforeEach(() => {
  headlineStory.mockResolvedValue(null);
  publishedStories.mockResolvedValue({ stories: [], total: 0 });
  publishedVideos.mockResolvedValue({ videos: [], total: 0 });
  upcomingEvents.mockResolvedValue({ events: [], total: 0 });
  activePlacements.mockResolvedValue([]);
  liveAdvertsByFormat.mockResolvedValue({});
  sentNewsletters.mockResolvedValue([]);
  memberDirectory.mockResolvedValue({ members: [], total: 0 });
  storyCategories.mockResolvedValue([]);
  showAdPlaceholders.mockResolvedValue(false);
  storyIntros.mockResolvedValue(new Map());
  requestContext.mockResolvedValue({ session_hash: null, referrer: null, region: null, company: null, consented: false });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("loadHome", () => {
  it("records a page_view with the request's attribution context", async () => {
    requestContext.mockResolvedValue({ session_hash: "abc", referrer: null, region: "West Midlands", company: null, consented: true });

    await loadHome();

    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "page_view", path: "/", session_hash: "abc" })]);
  });

  it("filters stories, member news and videos already claimed by the hero", async () => {
    publishedStories
      .mockResolvedValueOnce({ stories: [{ id: "s1" }, { id: "s2" }], total: 2 })
      .mockResolvedValueOnce({ stories: [{ id: "s2" }], total: 1 }); // member-only list
    publishedVideos.mockResolvedValue({ videos: [{ id: "v1", url: "https://www.youtube.com/watch?v=abc123" }], total: 1 });
    headlineStory.mockResolvedValue(null);

    const home = await loadHome();

    // buildHero(null, [s1,s2], [v1]) takes s1 (and v1) into the hero — whichever
    // ids it claims must not also appear in the plain lists below it
    const heroIds = new Set(home.heroItems.map((i) => i.key.replace(/^[sv]:/, "")));
    for (const s of home.stories) expect(heroIds.has(s.id)).toBe(false);
    for (const v of home.videos) expect(heroIds.has(v.id)).toBe(false);
  });

  it("splits placements into featured members vs. the (at most one) featured machine", async () => {
    activePlacements.mockResolvedValue([
      { kind: "featured_member", id: "p1" },
      { kind: "featured_member", id: "p2" },
      { kind: "featured_machine", id: "p3" },
    ]);

    const home = await loadHome();

    expect(home.featuredMembers).toHaveLength(2);
    expect(home.featuredMachine).toMatchObject({ id: "p3" });
  });

  it("caps newsletters at 3 and the logo wall at 12 members with a logo", async () => {
    sentNewsletters.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ number: i })));
    memberDirectory.mockResolvedValue({
      members: [
        ...Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, logo_path: `l${i}.jpg` })),
        { id: "no-logo", logo_path: null },
      ],
      total: 16,
    });

    const home = await loadHome();

    expect(home.newsletters).toHaveLength(3);
    expect(home.directory).toHaveLength(12);
    expect(home.directory.every((m) => m.logo_path)).toBe(true);
  });
});

describe("excluding", () => {
  it("drops items whose id is in the given set or iterable", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(excluding(items, new Set(["b"]))).toEqual([{ id: "a" }, { id: "c" }]);
    expect(excluding(items, ["a", "c"])).toEqual([{ id: "b" }]);
  });

  it("keeps everything when nothing is excluded", () => {
    const items = [{ id: "a" }];
    expect(excluding(items, [])).toEqual(items);
  });
});
