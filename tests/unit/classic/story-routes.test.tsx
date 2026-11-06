// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEFAULT_LAYOUTS } from "@/lib/blocks/defaults";
import type { StoryPageData } from "@/lib/story-page";

/**
 * Seam 2 of the Classic design option (#68, #74), at the routes: the published
 * story and the draft preview both render the Classic story piece through the
 * hook-point module (not mocked here, unlike tests/unit/design-option.test.tsx),
 * and the published page still carries its structured data.
 */

const m = vi.hoisted(() => ({
  currentUser: vi.fn(async (): Promise<unknown> => null),
  storyBySlug: vi.fn(),
  storyForPreview: vi.fn(),
  loadStoryPageData: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ currentUser: m.currentUser, isAdmin: () => false }));
vi.mock("@/lib/queries", () => ({ storyBySlug: m.storyBySlug, storyForPreview: m.storyForPreview }));
vi.mock("@/lib/analytics", () => ({ record: vi.fn(), requestContext: vi.fn(async () => ({})), newsletterClick: vi.fn(() => ({})) }));
vi.mock("@/lib/newsletter-tracking", () => ({ issueFromLink: vi.fn(async () => null), newsletterLinkParams: vi.fn(() => ({})) }));
vi.mock("@/lib/story-page", () => ({ loadStoryPageData: m.loadStoryPageData }));
vi.mock("@/lib/story-preview", () => ({ canPreviewStory: () => true, redirectsToLiveStory: () => false, previewBackHref: () => "/console" }));
vi.mock("@/lib/db/server", () => import("../../stubs/db-server"));
// An async server component, which a jsdom render can't await.
vi.mock("@/components/JoinCta", () => ({ JoinCta: () => null }));

import { resetDbServerMocks } from "../../stubs/db-server";
import StoryPage from "@/app/(public)/news/[slug]/page";
import StoryPreviewPage from "@/app/(public)/preview/story/[id]/page";

afterEach(() => {
  vi.clearAllMocks();
  resetDbServerMocks();
});

const routeProps = (params: Record<string, string>) =>
  ({ params: Promise.resolve(params), searchParams: Promise.resolve({}) }) as never;
const story = {
  id: "11111111-1111-4111-8111-111111111111", slug: "a-story", title: "A story", excerpt: null, body: "<p>Body.</p>",
  status: "draft", member_id: null, categories: [], cover_path: null, cover_focus: null, social_posts: null,
  published_at: "2026-10-13T09:00:00Z", is_member_news: false,
};
const data = (preview: boolean): StoryPageData => ({
  layout: DEFAULT_LAYOUTS.story,
  segments: ["<p>Body.</p>"],
  bodyKeys: [],
  slots: new Map(),
  latest: [],
  logos: [],
  showPlaceholders: preview,
  industrySlug: null,
  members: [{ name: "BLM Group", slug: "blm-group", logoUrl: null }],
  companyLinks: [],
});

const panel = (container: HTMLElement) => container.querySelector('[data-part="story-panel"]');

describe("the Classic story piece serves both story routes", () => {
  it("the published story renders it, with the article's structured data", async () => {
    m.storyBySlug.mockResolvedValue({ ...story, status: "published" });
    m.loadStoryPageData.mockResolvedValue(data(false));
    const { container } = render(await StoryPage(routeProps({ slug: "a-story" })));
    expect(panel(container)).not.toBeNull();
    expect(screen.getByRole("link", { name: "‹ Back to News" })).toBeInTheDocument();
    const ld = [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!));
    expect(ld.map((item) => item["@type"])).toEqual(["NewsArticle", "BreadcrumbList"]);
  });

  it("the preview renders the same piece", async () => {
    m.currentUser.mockResolvedValueOnce({ role: "admin", userId: "u1", memberId: null });
    m.storyForPreview.mockResolvedValue(story);
    m.loadStoryPageData.mockResolvedValue(data(true));
    const { container } = render(await StoryPreviewPage(routeProps({ id: story.id })));
    expect(screen.getByRole("status")).toHaveTextContent("Preview");
    expect(panel(container)).not.toBeNull();
    expect(screen.getByRole("link", { name: "‹ Back to News" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Featured SMI member" })).toBeInTheDocument();
  });
});
