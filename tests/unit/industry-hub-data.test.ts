import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadIndustryHub } from "@/lib/industry-hub";

type Rec = Record<string, unknown>;
const WELDING = { id: 7, slug: "welding", name: "Welding" };

const { industryBySlug, publishedStories, memberDirectory, publishedVideos, upcomingEvents, pastEvents, requestContext, record } =
  vi.hoisted(() => ({
    industryBySlug: vi.fn<() => Promise<Rec | null>>(async () => null),
    publishedStories: vi.fn<() => Promise<{ stories: Rec[]; total: number }>>(async () => ({ stories: [], total: 0 })),
    memberDirectory: vi.fn<() => Promise<{ members: Rec[]; total: number }>>(async () => ({ members: [], total: 0 })),
    publishedVideos: vi.fn<() => Promise<{ videos: Rec[]; total: number }>>(async () => ({ videos: [], total: 0 })),
    upcomingEvents: vi.fn<() => Promise<{ events: Rec[]; total: number }>>(async () => ({ events: [], total: 0 })),
    pastEvents: vi.fn<() => Promise<{ events: Rec[]; total: number }>>(async () => ({ events: [], total: 0 })),
    requestContext: vi.fn(async () => ({ session_hash: null as string | null, referrer: null as string | null, region: null as string | null, company: null as string | null, consented: false })),
    record: vi.fn(() => {}),
  }));

vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  industryBySlug, publishedStories, memberDirectory, publishedVideos, upcomingEvents, pastEvents,
}));
vi.mock("@/lib/analytics", () => ({ requestContext, record }));

beforeEach(() => {
  industryBySlug.mockResolvedValue(WELDING);
  publishedStories.mockResolvedValue({ stories: [], total: 0 });
  memberDirectory.mockResolvedValue({ members: [], total: 0 });
  publishedVideos.mockResolvedValue({ videos: [], total: 0 });
  upcomingEvents.mockResolvedValue({ events: [], total: 0 });
  pastEvents.mockResolvedValue({ events: [], total: 0 });
  requestContext.mockResolvedValue({ session_hash: null, referrer: null, region: null, company: null, consented: false });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("loadIndustryHub", () => {
  it("returns null for an unknown slug without fetching any section", async () => {
    industryBySlug.mockResolvedValue(null);

    expect(await loadIndustryHub("bogus")).toBeNull();
    expect(publishedStories).not.toHaveBeenCalled();
    expect(memberDirectory).not.toHaveBeenCalled();
    expect(publishedVideos).not.toHaveBeenCalled();
    expect(upcomingEvents).not.toHaveBeenCalled();
  });

  it("resolves the industry once and fans its id out to the content sections", async () => {
    await loadIndustryHub("welding");

    // The id, not the slug — passing the slug would make each section repeat
    // the same industries lookup. This assertion is the design decision.
    expect(publishedStories).toHaveBeenCalledWith(expect.objectContaining({ industry: 7 }));
    expect(publishedVideos).toHaveBeenCalledWith(expect.objectContaining({ industry: 7 }));
    expect(upcomingEvents).toHaveBeenCalledWith(expect.objectContaining({ industry: 7 }));
    // memberDirectory is the exception: its API takes slugs and seeds its daily
    // shuffle from the slug string.
    expect(memberDirectory).toHaveBeenCalledWith(expect.objectContaining({ industries: ["welding"] }));
  });

  it("returns each section's rows and its full count, not the page count", async () => {
    publishedStories.mockResolvedValue({ stories: [{ id: "s1" }], total: 40 });
    memberDirectory.mockResolvedValue({ members: [{ slug: "acme" }], total: 12 });
    publishedVideos.mockResolvedValue({ videos: [{ id: "v1" }], total: 3 });
    upcomingEvents.mockResolvedValue({ events: [{ slug: "e1" }], total: 2 });

    const hub = (await loadIndustryHub("welding"))!;

    expect(hub.industry).toEqual(WELDING);
    expect(hub.stories).toEqual([{ id: "s1" }]);
    expect(hub.storyTotal).toBe(40);
    expect(hub.memberTotal).toBe(12);
    expect(hub.videoTotal).toBe(3);
    expect(hub.eventTotal).toBe(2);
  });

  it("does not reach for past events while something is still upcoming", async () => {
    upcomingEvents.mockResolvedValue({ events: [{ slug: "e1" }], total: 1 });

    const hub = (await loadIndustryHub("welding"))!;

    expect(pastEvents).not.toHaveBeenCalled();
    expect(hub.eventsTense).toBe("upcoming");
    expect(hub.events).toEqual([{ slug: "e1" }]);
  });

  it("falls back to past events when the industry has nothing upcoming", async () => {
    upcomingEvents.mockResolvedValue({ events: [], total: 0 });
    pastEvents.mockResolvedValue({ events: [{ slug: "old" }], total: 9 });

    const hub = (await loadIndustryHub("welding"))!;

    expect(pastEvents).toHaveBeenCalledWith(expect.objectContaining({ industry: 7 }));
    // The tense is what stops the view heading finished events "Upcoming".
    expect(hub.eventsTense).toBe("past");
    expect(hub.events).toEqual([{ slug: "old" }]);
    expect(hub.eventTotal).toBe(9);
  });

  it("records a page_view for the industry path with the request's attribution context", async () => {
    requestContext.mockResolvedValue({ session_hash: "abc", referrer: null, region: "West Midlands", company: null, consented: true });

    await loadIndustryHub("welding");

    expect(record).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "page_view", path: "/industry/welding", session_hash: "abc" }),
    ]);
  });
});
