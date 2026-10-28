// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockRenderer, STORY_AD_WRAPPER } from "@/components/blocks/BlockRenderer";
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
        path="/news"
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
      <BlockRenderer pageType="static_page" path="/news" layout={layout({ id: "b1", type: "latest_news" })} anchors={{}} latestStories={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("caps latest_news to the block's limit", () => {
    const stories = [story({ id: "1", title: "One" }), story({ id: "2", title: "Two" }), story({ id: "3", title: "Three" })];
    render(
      <BlockRenderer
        pageType="static_page"
        path="/news"
        layout={layout({ id: "b1", type: "latest_news", props: { limit: 2 } })}
        anchors={{}}
        latestStories={stories}
      />,
    );
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.queryByText("Three")).not.toBeInTheDocument();
  });

  it("falls back to \"this member\" in the heading when no member name is passed", () => {
    render(
      <BlockRenderer
        pageType="member_profile"
        path="/news"
        layout={layout({ id: "b1", type: "member_news" })}
        anchors={{}}
        memberStories={[story()]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Stories featuring this member" })).toBeInTheDocument();
  });

  // A carousel of whatever the page fetched — a stored limit from an older
  // layout row (the editor used to offer one) no longer cuts it to 4.
  it("member_news shows every story it is given, ignoring a stored limit", () => {
    const stories = [story({ id: "1", title: "One" }), story({ id: "2", title: "Two" }), story({ id: "3", title: "Three" })];
    render(
      <BlockRenderer
        pageType="member_profile"
        path="/member/acme"
        layout={layout({ id: "b1", type: "member_news", props: { limit: 1 } })}
        anchors={{}}
        memberStories={stories}
        memberName="Acme Fabrication"
      />,
    );
    expect(screen.getByRole("heading", { name: "Stories featuring Acme Fabrication" })).toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.getByText("Three")).toBeInTheDocument();
  });

  it("member_news links to See more only when the member has more stories than the carousel holds", () => {
    const stories = [story({ id: "1", title: "One" }), story({ id: "2", title: "Two" })];
    const props = {
      pageType: "member_profile" as const,
      path: "/member/acme",
      layout: layout({ id: "b1", type: "member_news" }),
      anchors: {},
      memberStories: stories,
      memberStoriesHref: "/news?member=acme#all-news",
    };
    const { rerender } = render(<BlockRenderer {...props} memberStoriesTotal={2} />);
    expect(screen.queryByRole("link", { name: "See more →" })).not.toBeInTheDocument();

    rerender(<BlockRenderer {...props} memberStoriesTotal={13} />);
    expect(screen.getByRole("link", { name: "See more →" })).toHaveAttribute("href", "/news?member=acme#all-news");
  });
});

describe("ad_banner", () => {
  it("renders nothing for an empty slot when placeholders are off", () => {
    const { container } = render(
      <BlockRenderer pageType="static_page" path="/news" layout={layout({ id: "b1", type: "ad_banner" })} anchors={{}} showPlaceholders={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the margin wrapper for an empty slot once placeholders are on", () => {
    // The wrapper carries the vertical rhythm, so it must appear exactly when
    // the slot does — never around nothing.
    const { container } = render(
      <BlockRenderer pageType="static_page" path="/news" layout={layout({ id: "b1", type: "ad_banner" })} anchors={{}} showPlaceholders />,
    );
    expect(container.querySelector(".my-8")).toBeInTheDocument();
  });

  // Jas 13/10 item 6: the story page caps its mobile adverts; nothing else does.
  it("uses the caller's wrapper class when one is given, and my-8 otherwise", () => {
    const { container } = render(
      <BlockRenderer pageType="story" path="/news/x" layout={layout({ id: "b1", type: "ad_banner" })} anchors={{}} showPlaceholders adWrapperClassName={STORY_AD_WRAPPER} />,
    );
    const wrapper = container.querySelector(".my-8");
    expect(wrapper).toHaveClass("max-w-[300px]", "md:max-w-none", "mx-auto");
  });
});

describe("join_cta", () => {
  it("renders the join CTA", () => {
    render(<BlockRenderer pageType="static_page" path="/news" layout={layout({ id: "b1", type: "join_cta" })} anchors={{}} />);
    expect(screen.getByTestId("join-cta")).toBeInTheDocument();
  });
});

describe("newsletter_signup", () => {
  it("renders the signup form", () => {
    render(<BlockRenderer pageType="static_page" path="/news" layout={layout({ id: "b1", type: "newsletter_signup" })} anchors={{}} />);
    expect(screen.getByPlaceholderText("you@company.co.uk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });
});

describe("supplier_logos", () => {
  it("renders nothing with no adverts and placeholders off", () => {
    const { container } = render(
      <BlockRenderer pageType="static_page" path="/news" layout={layout({ id: "b1", type: "supplier_logos" })} anchors={{}} showPlaceholders={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the placeholder rail with no adverts at all", () => {
    const { container } = render(
      <BlockRenderer pageType="static_page" path="/news" layout={layout({ id: "b1", type: "supplier_logos" })} anchors={{}} showPlaceholders />,
    );
    expect(container.querySelector(".-mx-4")).toBeInTheDocument();
  });

  it("renders a logo image per live advert", () => {
    const { container } = render(
      <BlockRenderer
        pageType="static_page"
        path="/news"
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
        path="/news"
        layout={layout({ id: "b1", type: "page_main" })}
        anchors={{ page_main: <p>Page body</p> }}
      />,
    );
    expect(screen.getByText("Page body")).toBeInTheDocument();
  });

  it("renders an empty wrapper when the layout has an anchor block the page did not supply", () => {
    // A layout row can name an anchor the caller has nothing for. That must be
    // an empty slot, not a crash.
    const { container } = render(
      <BlockRenderer pageType="static_page" path="/news" layout={layout({ id: "b1", type: "page_main" })} anchors={{}} />,
    );
    expect(container.querySelector("div")).toBeEmptyDOMElement();
  });
});

describe("unknown block types", () => {
  it("renders nothing", () => {
    const { container } = render(
      <BlockRenderer pageType="static_page" path="/news" layout={layout({ id: "b1", type: "story_hero" })} anchors={{}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
