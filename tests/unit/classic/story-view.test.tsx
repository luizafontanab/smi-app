// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ClassicStoryView } from "@/components/classic/ClassicStoryView";
import { DEFAULT_LAYOUTS } from "@/lib/blocks/defaults";
import type { StoryPageData } from "@/lib/story-page";
import { resetDbServerMocks } from "../../stubs/db-server";

/**
 * Seam 2 of the Classic design option (#68, #74): the Classic story page.
 * "‹ Back to News", then the article in one white panel with the member tiles
 * under it, then whatever the admin's layout puts after the article. Sharing,
 * the source-member link, adverts and structured data are what Current has.
 */

// AdSlot and the cover resolve media URLs; JoinCta/NewsletterSignup reach serviceDb.
vi.mock("@/lib/db/server", () => import("../../stubs/db-server"));
// An async server component, which a jsdom render can't await. A stand-in
// marks where the layout's join_cta block lands.
vi.mock("@/components/JoinCta", () => ({ JoinCta: () => <section data-testid="join-cta" /> }));

afterEach(() => {
  resetDbServerMocks();
});

const story = { title: "BLM opens a new show room", published_at: "2026-10-13T09:00:00Z", is_member_news: false, cover_focus: null };
const members = [
  { name: "BLM Group", slug: "blm-group", logoUrl: null },
  { name: "Trumpf", slug: "trumpf", logoUrl: null },
];

const data = (over: Partial<StoryPageData> = {}): StoryPageData => ({
  layout: DEFAULT_LAYOUTS.story,
  segments: ["<p>First half.</p>", "<p>Second half.</p>"],
  bodyKeys: ["story_body_ad_1"],
  slots: new Map([["story_ad_1", []], ["story_ad_2", []], ["story_body_ad_1", []]]),
  latest: [],
  logos: [],
  // the preview's setting: every advert position draws its labelled footprint
  showPlaceholders: true,
  industrySlug: null,
  members,
  companyLinks: [{ name: "BLM Group", href: "/go/m1?kind=website", website: "https://blm.example", primary: true }],
  ...over,
});

const renderView = (over: Partial<StoryPageData> = {}) =>
  render(
    <ClassicStoryView
      story={story}
      categories={[{ slug: "lasers", name: "Lasers" }]}
      cover="https://cdn.example/cover.jpg"
      members={members}
      socialPosts={null}
      data={data(over)}
      path="/news/blm-show-room"
    />,
  );

const panel = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-part="story-panel"]')!;

describe("ClassicStoryView: the panel", () => {
  it("puts '‹ Back to News' above one panel that holds the headline and the article", () => {
    const { container } = renderView();
    const back = screen.getByRole("link", { name: "‹ Back to News" });
    expect(back).toHaveAttribute("href", "/news");
    const box = panel(container);
    expect(box).not.toBeNull();
    expect(box).not.toContainElement(back);
    expect(back.compareDocumentPosition(box)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(box).getByRole("heading", { level: 1, name: story.title })).toBeInTheDocument();
    expect(within(box).getByRole("article")).toHaveTextContent(/First half\..*Second half\./);
  });
});

describe("ClassicStoryView: the member tiles", () => {
  it("come after the article body, inside the panel, as one column rather than a sidebar", () => {
    const { container } = renderView();
    const box = panel(container);
    const article = within(box).getByRole("article");
    const tiles = within(box).getByRole("complementary", { name: "Featured SMI members" });
    expect(article).not.toContainElement(tiles);
    expect(article.compareDocumentPosition(tiles)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(tiles).getByRole("link", { name: /BLM Group/ })).toHaveAttribute("href", "/member/blm-group");
    // Current's page layout puts them in a grid column beside the article from lg.
    expect(container.querySelector('[data-part="story-layout"]')).toBeNull();
  });

  it("leave no box behind when the story features no member", () => {
    const { container } = render(
      <ClassicStoryView story={story} categories={[]} cover={null} members={[]} socialPosts={null} data={data({ members: [], companyLinks: [] })} path="/news/x" />,
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(container.querySelector('[data-part="story-aside"]')).toBeNull();
  });
});

describe("ClassicStoryView: what Current's story page keeps", () => {
  it("keeps the share row and the source-member link in the article", () => {
    const { container } = renderView();
    const article = within(panel(container)).getByRole("article");
    expect(within(article).getByRole("heading", { name: "View / share on our socials" })).toBeInTheDocument();
    expect(within(article).getByRole("link", { name: /on LinkedIn/ })).toHaveAttribute("target", "_blank");
    expect(within(article).getByRole("link", { name: "BLM Group" })).toHaveAttribute("href", "/go/m1?kind=website");
  });

  // The placeholder footprints carry their slot key, so they show which
  // position each advert holds. Positions are dealt by index across the whole
  // layout: cutting it round the panel must not renumber them.
  it("keeps every advert position, numbered as Current numbers them: the top one in the panel, the foot one after it", () => {
    const { container } = renderView();
    const box = panel(container);
    expect(box).toHaveTextContent("story_ad_1");
    expect(box).toHaveTextContent("story_body_ad_1");
    expect(box).not.toHaveTextContent("story_ad_2");
    const foot = [...container.querySelectorAll('[data-part="ad-placeholder"]')].filter((el) => !box.contains(el));
    expect(foot.map((el) => el.textContent)).toEqual([expect.stringContaining("story_ad_2")]);
    expect(box.compareDocumentPosition(foot[0])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("the body's advert break sits between the two halves of the body", () => {
    const { container } = renderView();
    const halves = container.querySelectorAll('[data-part="story-body"]');
    expect(halves).toHaveLength(2);
    const breakAd = [...container.querySelectorAll('[data-part="ad-placeholder"]')].find((el) => el.textContent?.includes("story_body_ad_1"))!;
    expect(halves[0].compareDocumentPosition(breakAd)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(breakAd.compareDocumentPosition(halves[1])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("an empty advert position on the public page leaves nothing behind", () => {
    const { container } = renderView({ showPlaceholders: false });
    expect(container.querySelector('[data-part="ad-placeholder"]')).toBeNull();
    expect(container.querySelector('[data-part="ad-slot-wrap"]')).toBeNull();
  });

  it("puts the layout's blocks after the article outside the panel, in the layout's order", () => {
    const { container } = renderView();
    const box = panel(container);
    const join = screen.getByTestId("join-cta");
    const signup = container.querySelector('[data-part="newsletter-signup-block"]')!;
    expect(box).not.toContainElement(join);
    expect(box.compareDocumentPosition(join)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(join.compareDocumentPosition(signup)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("draws one back link, from the layout's own block", () => {
    renderView({ layout: { ...DEFAULT_LAYOUTS.story, blocks: DEFAULT_LAYOUTS.story.blocks.map((b) => (b.type === "back_link" ? { ...b, props: { label: "Back to Laser news", href: "/industry/laser" } } : b)) } });
    expect(screen.getAllByRole("link", { name: /Back to/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "‹ Back to Laser news" })).toHaveAttribute("href", "/industry/laser");
  });

  // Classic's story page always starts "‹ Back to News" (#68, #74), even when
  // the admin's layout has no back_link block of its own.
  it("still draws one '‹ Back to News' when the layout has no back_link block", () => {
    renderView({ layout: { ...DEFAULT_LAYOUTS.story, blocks: DEFAULT_LAYOUTS.story.blocks.filter((b) => b.type !== "back_link") } });
    expect(screen.getAllByRole("link", { name: /Back to/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "‹ Back to News" })).toHaveAttribute("href", "/news");
  });
});
