// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockRenderer } from "@/components/blocks/BlockRenderer";
import type { Block, PageLayout } from "@/lib/blocks/schema";
import type { LiveAdvert } from "@/lib/adverts";
import type { StoryCard as StoryCardType } from "@/lib/queries";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

// JoinCta is `export async function JoinCta()` — an async Server Component.
// RTL's client-side render() can't render a component whose body returns a
// Promise, so it's swapped for a synchronous stand-in here.
vi.mock("@/components/JoinCta", () => ({
  JoinCta: () => <div data-testid="join-cta" />,
}));

afterEach(() => {
  resetDbServerMocks();
});

function layout(...blocks: Block[]): PageLayout {
  return { version: 1, blocks };
}

function story(overrides: Partial<StoryCardType> = {}): StoryCardType {
  return {
    id: "s1",
    slug: "story-1",
    title: "A Story",
    excerpt: null,
    cover_path: null,
    cover_focus: null,
    published_at: null,
    is_member_news: false,
    member: null,
    ...overrides,
  };
}

function advert(overrides: Partial<LiveAdvert> = {}): LiveAdvert {
  return {
    advertId: "ad1",
    name: "Acme Fabrication",
    desktopPath: "adverts/ad1-desktop.jpg",
    mobilePath: "adverts/ad1-mobile.jpg",
    linkUrl: null,
    memberSlug: "acme",
    memberId: "m1",
    ...overrides,
  };
}

describe("back_link", () => {
  it("renders the label and href", () => {
    render(
      <BlockRenderer
        pageType="static_page"
        layout={layout({ id: "b1", type: "back_link", props: { label: "Back to news", href: "/news" } })}
        anchors={{}}
      />,
    );
    expect(screen.getByRole("link", { name: "← Back to news" })).toHaveAttribute("href", "/news");
  });
});

describe("latest_news / member_news", () => {
  it("renders nothing when there are no matching stories", () => {
    const { container } = render(
      <BlockRenderer pageType="static_page" layout={layout({ id: "b1", type: "latest_news" })} anchors={{}} latestStories={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("caps latest_news to the block's limit", () => {
    const stories = [story({ id: "1", title: "One" }), story({ id: "2", title: "Two" }), story({ id: "3", title: "Three" })];
    render(
      <BlockRenderer
        pageType="static_page"
        layout={layout({ id: "b1", type: "latest_news", props: { limit: 2 } })}
        anchors={{}}
        latestStories={stories}
      />,
    );
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.queryByText("Three")).not.toBeInTheDocument();
  });

  it("member_news with limit 0 shows every story about the member", () => {
    const stories = [story({ id: "1", title: "One" }), story({ id: "2", title: "Two" }), story({ id: "3", title: "Three" })];
    render(
      <BlockRenderer
        pageType="member_profile"
        layout={layout({ id: "b1", type: "member_news", props: { limit: 0 } })}
        anchors={{}}
        memberStories={stories}
        memberName="Acme Fabrication"
      />,
    );
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.getByText("Three")).toBeInTheDocument();
  });
});

describe("ad_banner", () => {
  it("renders nothing for an empty slot when placeholders are off", () => {
    const { container } = render(
      <BlockRenderer pageType="static_page" layout={layout({ id: "b1", type: "ad_banner" })} anchors={{}} showPlaceholders={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("join_cta", () => {
  it("renders the join CTA", () => {
    render(<BlockRenderer pageType="static_page" layout={layout({ id: "b1", type: "join_cta" })} anchors={{}} />);
    expect(screen.getByTestId("join-cta")).toBeInTheDocument();
  });
});

describe("newsletter_signup", () => {
  it("renders the signup form", () => {
    render(<BlockRenderer pageType="static_page" layout={layout({ id: "b1", type: "newsletter_signup" })} anchors={{}} />);
    expect(screen.getByPlaceholderText("you@company.co.uk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });
});

describe("supplier_logos", () => {
  it("renders nothing with no adverts and placeholders off", () => {
    const { container } = render(
      <BlockRenderer pageType="static_page" layout={layout({ id: "b1", type: "supplier_logos" })} anchors={{}} showPlaceholders={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a logo image per live advert", () => {
    const { container } = render(
      <BlockRenderer
        pageType="static_page"
        layout={layout({ id: "b1", type: "supplier_logos" })}
        anchors={{}}
        supplierLogos={[advert()]}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("alt", "Acme Fabrication");
  });
});

describe("anchors", () => {
  it("renders the anchor content passed in for the block's type", () => {
    render(
      <BlockRenderer
        pageType="static_page"
        layout={layout({ id: "b1", type: "page_main" })}
        anchors={{ page_main: <p>Page body</p> }}
      />,
    );
    expect(screen.getByText("Page body")).toBeInTheDocument();
  });
});

describe("unknown block types", () => {
  it("renders nothing", () => {
    const { container } = render(
      <BlockRenderer pageType="static_page" layout={layout({ id: "b1", type: "story_hero" })} anchors={{}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
