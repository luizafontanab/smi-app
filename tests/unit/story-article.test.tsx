// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoryHeader, StoryHero, StoryMain, storyAnchors } from "@/components/story/StoryArticle";

const story = { title: "BLM new show room", published_at: "2026-10-13T09:00:00Z", is_member_news: true, cover_focus: null };

describe("StoryArticle pieces", () => {
  it("hero: a member's logo standing in for the cover is drawn whole on white (Jas 28/10)", () => {
    const { container } = render(<StoryHero cover="/media/members/acme.png" focus={null} logo />);
    const box = screen.getByTestId("story-cover");
    expect(box).toHaveAttribute("data-logo");
    expect(box.className).toContain("bg-white");
    expect(container.querySelector("img")?.className).toContain("object-contain");
  });

  it("header: member-news badge, category pills and the dated byline", () => {
    render(<StoryHeader story={story} categories={[{ slug: "news", name: "News" }]} />);
    expect(screen.getByRole("heading", { level: 1, name: "BLM new show room" })).toBeInTheDocument();
    expect(screen.getByText("Member news")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "News" })).toHaveAttribute("href", "/news?category=news");
    expect(screen.getByText(/13 October 2026/)).toBeInTheDocument();
  });

  // Jas 13/10: the story heading always shows in capitals. Display only: the
  // stored title keeps its case for search, link previews and the newsletter.
  it("title: capitals by CSS, text kept as written", () => {
    render(<StoryHeader story={story} categories={[]} />);
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveClass("uppercase", "text-3xl", "text-ink");
    expect(title).toHaveTextContent("BLM new show room");
  });

  it("hero renders nothing without a cover", () => {
    const { container } = render(<StoryHero cover={null} focus={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Jas 13/10 item 13: article + member sidebar side by side from lg; the
  // sidebar follows the article in the DOM so it stacks after it on phones.
  it("page layout: the article, then a sidebar of member tiles after it", () => {
    const { container } = render(
      <StoryMain body={<p>Body copy</p>} share={<p>Share row</p>} members={[{ name: "BLM Group", slug: "blm-group", logoUrl: null }]} />,
    );
    const layout = container.querySelector(".story-layout--aside")!;
    expect(layout).toHaveClass("lg:grid");
    const article = layout.querySelector("article.story-read")!;
    expect(article).toHaveTextContent(/Body copy.*Share row/);
    expect(article).not.toHaveTextContent("BLM Group");
    expect(article.compareDocumentPosition(screen.getByRole("complementary"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole("link", { name: /BLM Group/ })).toHaveAttribute("href", "/member/blm-group");
  });

  it("page layout: no members, no sidebar and no grid", () => {
    const { container } = render(<StoryMain body={<p>Body</p>} members={[]} />);
    expect(container.querySelector(".story-layout--aside")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("the sidebar only sticks while it's short enough to fit a screen", () => {
    const m = (i: number) => ({ name: `M${i}`, slug: `m${i}`, logoUrl: null });
    const { container, rerender } = render(<StoryMain body={null} members={[1, 2, 3, 4].map(m)} />);
    expect(container.querySelector(".lg\\:sticky")).not.toBeNull();
    rerender(<StoryMain body={null} members={[1, 2, 3, 4, 5].map(m)} />);
    expect(container.querySelector(".lg\\:sticky")).toBeNull();
  });

  it("inline layout: one column, tiles under the article", () => {
    const { container } = render(<StoryMain body={<p>B</p>} members={[{ name: "BLM", slug: "blm", logoUrl: null }]} layout="inline" />);
    expect(container.querySelector(".story-layout--aside")).toBeNull();
    expect(screen.getByRole("link", { name: /BLM/ })).toBeInTheDocument();
  });

  it("anchors key the three parts by the story layout's anchor block types", () => {
    const anchors = storyAnchors({ story, categories: [], cover: null, main: <p>m</p> });
    expect(Object.keys(anchors).sort()).toEqual(["story_body", "story_header", "story_hero"]);
  });
});
