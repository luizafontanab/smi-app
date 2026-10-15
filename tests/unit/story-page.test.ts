import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveAdvert } from "@/lib/adverts";

const { liveAdverts, showAdPlaceholders, getLayout, publishedStories, storyIndustrySlug, storyMembers, taggedMembers } = vi.hoisted(() => ({
  storyMembers: vi.fn(async () => [{ id: "m1", slug: "blm", name: "BLM", logo_path: null, website: "https://blm.example", status: "active" }]),
  taggedMembers: vi.fn(async () => [
    { id: "m1", slug: "blm", name: "BLM", logo_path: "logos/blm.png", website: null, social: {}, status: "active", archived_at: null },
    { id: "m2", slug: "gone", name: "Gone Ltd", logo_path: null, social: {}, status: "active", archived_at: "2026-10-01" },
  ]),
  liveAdverts: vi.fn(async (): Promise<LiveAdvert[]> => []),
  showAdPlaceholders: vi.fn(async () => false),
  getLayout: vi.fn(),
  publishedStories: vi.fn(async () => ({ stories: [] as { id: string; slug: string }[] })),
  storyIndustrySlug: vi.fn(async (): Promise<string | null> => "laser"),
}));

vi.mock("@/lib/adverts", async (orig) => ({
  ...(await orig<typeof import("@/lib/adverts")>()),
  liveAdverts,
  showAdPlaceholders,
}));
vi.mock("@/lib/blocks/layouts", () => ({ getLayout }));
vi.mock("@/lib/queries", () => ({ publishedStories, storyIndustrySlug, storyMembers }));
vi.mock("@/lib/story-members", () => ({ taggedMembers }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

import { loadStoryPageData } from "@/lib/story-page";
import { DEFAULT_LAYOUTS } from "@/lib/blocks/defaults";

const banner = (id: string) => ({ advertId: id, format: "banner" }) as unknown as LiveAdvert;
const story = { id: "s1", slug: "my-story", body: `<p>a</p><hr data-ad-break=""><p>b</p>`, member_id: "m1" };

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadStoryPageData", () => {
  it("deals real banners across the layout's slots and the body's breaks", async () => {
    getLayout.mockResolvedValue(DEFAULT_LAYOUTS.story);
    liveAdverts.mockResolvedValue([banner("a"), banner("b"), banner("c")]);
    const data = await loadStoryPageData(story);
    expect(data.segments).toHaveLength(2);
    expect(data.bodyKeys).toHaveLength(1);
    expect(data.slots.has(data.bodyKeys[0])).toBe(true);
    expect([...data.slots.values()].flat().length).toBeGreaterThan(0);
    expect(data.industrySlug).toBe("laser");
  });

  it("drops the story itself from the latest-news row", async () => {
    getLayout.mockResolvedValue(DEFAULT_LAYOUTS.story);
    publishedStories.mockResolvedValue({ stories: [{ id: "s1", slug: "my-story" }, { id: "s2", slug: "other" }] });
    const data = await loadStoryPageData(story);
    expect(data.latest.map((s) => s.slug)).not.toContain("my-story");
  });

  // Jas 13/10 items 10/15: the preview shows where adverts sit, but never a real
  // creative — an unmounted creative can't beacon an impression.
  it("in preview: no adverts fetched, every slot empty, placeholders forced on", async () => {
    getLayout.mockResolvedValue(DEFAULT_LAYOUTS.story);
    const data = await loadStoryPageData(story, { preview: true });
    expect(liveAdverts).not.toHaveBeenCalled();
    expect(showAdPlaceholders).not.toHaveBeenCalled();
    expect(data.showPlaceholders).toBe(true);
    expect([...data.slots.values()].every((ads) => ads.length === 0)).toBe(true);
    expect(data.logos).toEqual([]);
    expect(storyIndustrySlug).not.toHaveBeenCalled();
  });

  // Jas 13/10 item 12: every featured member's tile, from the right reader.
  it("public: the featured members come from the RLS-bound read, primary first", async () => {
    getLayout.mockResolvedValue(DEFAULT_LAYOUTS.story);
    const data = await loadStoryPageData(story);
    expect(storyMembers).toHaveBeenCalledWith("s1", "m1");
    expect(taggedMembers).not.toHaveBeenCalled();
    expect(data.members).toEqual([{ name: "BLM", slug: "blm", logoUrl: null }]);
    // the subject member's website closes the story, through the tracked click-through
    expect(data.companyLinks).toEqual([{ name: "BLM", href: "/go/m1?kind=website", website: "https://blm.example", primary: true }]);
  });

  it("no company line when the subject member has no website on file", async () => {
    getLayout.mockResolvedValue(DEFAULT_LAYOUTS.story);
    const data = await loadStoryPageData(story, { preview: true });
    expect(data.companyLinks).toEqual([]);
  });

  it("preview: the service-role read, with archived members dropped by hand", async () => {
    getLayout.mockResolvedValue(DEFAULT_LAYOUTS.story);
    const data = await loadStoryPageData(story, { preview: true });
    expect(storyMembers).not.toHaveBeenCalled();
    expect(data.members.map((m) => m.slug)).toEqual(["blm"]);
  });
});
