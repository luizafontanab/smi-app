// @vitest-environment jsdom
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GridHome } from "@/app/(public)/home.grid";
import {
  GhLatestList, GhMoreNews, GhStatsBand, GhStoryCard,
} from "@/components/grid-home/cards";
import type { HomeData } from "@/app/(public)/home.data";
import type { StoryCard as StoryCardType } from "@/lib/queries";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
// NewsletterSignup (reached via GhNewsletterPanel) imports the public server
// actions module; nothing here exercises the action itself.
vi.mock("@/app/(public)/actions", () => ({ subscribeNewsletter: vi.fn() }));

const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn(async () => null as unknown) }));
vi.mock("@/lib/auth", () => ({ currentUser }));

const story = (over: Partial<StoryCardType> = {}): StoryCardType => ({
  id: "s1",
  slug: "s1",
  title: "Press brake investment doubles capacity",
  excerpt: "A short summary.",
  cover_path: null,
  cover_focus: null,
  published_at: "2026-07-14T09:00:00Z",
  is_member_news: false,
  member: null,
  ...over,
} as StoryCardType);

beforeEach(() => {
  currentUser.mockResolvedValue(null);
});

afterEach(() => {
  resetDbServerMocks();
  vi.clearAllMocks();
});

describe("GhStoryCard", () => {
  it("badges member news and leaves industry news unbadged", () => {
    const { rerender } = render(<GhStoryCard story={story({ is_member_news: true })} />);
    expect(screen.getByText("Member news")).toBeInTheDocument();
    rerender(<GhStoryCard story={story({ is_member_news: false })} />);
    expect(screen.queryByText("Member news")).not.toBeInTheDocument();
  });

  it("drops the excerpt at the small size, where there is no room for it", () => {
    const { rerender } = render(<GhStoryCard story={story()} size="md" />);
    expect(screen.getByText("A short summary.")).toBeInTheDocument();
    rerender(<GhStoryCard story={story()} size="sm" />);
    expect(screen.queryByText("A short summary.")).not.toBeInTheDocument();
  });
});

describe("GhMoreNews", () => {
  it("renders one link per story", () => {
    render(<GhMoreNews stories={[story({ id: "a", slug: "a", title: "First" }), story({ id: "b", slug: "b", title: "Second" })]} />);
    expect(screen.getByRole("link", { name: /First/ })).toHaveAttribute("href", "/news/a");
    expect(screen.getByRole("link", { name: /Second/ })).toHaveAttribute("href", "/news/b");
  });

  it("renders nothing rather than an empty panel", () => {
    const { container } = render(<GhMoreNews stories={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // Marking member news wherever it sits among industry news is a commercial
  // rule, not styling. Asserted here because whether a member story lands in
  // the carousel's slice depends entirely on the day's content.
  it("badges member news in the carousel and leaves industry news unbadged", () => {
    render(
      <GhMoreNews
        stories={[
          story({ id: "a", slug: "a", title: "Industry piece", is_member_news: false }),
          story({ id: "b", slug: "b", title: "Member piece", is_member_news: true }),
        ]}
      />,
    );
    expect(screen.getAllByText("Member news")).toHaveLength(1);
  });
});

describe("GhLatestList", () => {
  it("renders one row per supplied kind, keeping the caller's order", () => {
    render(
      <GhLatestList
        items={[
          { eyebrow: "Latest news", label: "Steel tariffs", href: "/news/x" },
          { eyebrow: "Upcoming event", label: "EuroBLECH 2026", href: "/event/eb" },
        ]}
      />,
    );
    expect(screen.getByText("Latest news")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /EuroBLECH 2026/ })).toHaveAttribute("href", "/event/eb");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders nothing when no kind has content", () => {
    const { container } = render(<GhLatestList items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("GhStatsBand", () => {
  it("shows the join CTA to signed-out visitors, with the real counts", async () => {
    render(await GhStatsBand({ storyTotal: 1968, memberCount: 82 }));
    expect(screen.getByText("1,968")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sign up for membership/i })).toHaveAttribute("href", "/join");
  });

  it("keeps the numbers but drops the CTA for a signed-in member", async () => {
    currentUser.mockResolvedValue({ email: "member1@smi.local" });
    render(await GhStatsBand({ storyTotal: 1968, memberCount: 82 }));
    expect(screen.getByText("1,968")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Sign up for membership/i })).not.toBeInTheDocument();
  });
});

/** Walk a returned element tree collecting every AdSlot's slotKey prop. */
function slotKeys(node: ReactNode, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) slotKeys(child, found);
    return found;
  }
  if (!isValidElement(node)) return found;
  const props = node.props as { slotKey?: string; children?: ReactNode };
  if (typeof props.slotKey === "string") found.push(props.slotKey);
  slotKeys(props.children, found);
  return found;
}

const homeData = (over: Partial<HomeData> = {}): HomeData => ({
  heroItems: [],
  stories: [],
  memberNews: [],
  videos: [],
  events: [],
  featuredMembers: [],
  featuredMachine: undefined,
  newsletters: [],
  directory: [],
  memberCount: 0,
  storyTotal: 0,
  categories: [],
  adverts: { banner: [], supplier_logo: [], skyscraper: [], mpu: [], in_feed: [] },
  showPlaceholders: true,
  ...over,
} as unknown as HomeData);

describe("GridHome", () => {
  // The page is composed with no data at all on a fresh install, and on the
  // visual-regression run, which forces an empty advert inventory.
  it("composes without content or adverts", () => {
    expect(() => GridHome(homeData())).not.toThrow();
  });

  /*
   * Advert inventory, asserted rather than left to a reader of the JSX.
   *
   * As of 17 Sep this page carries THREE positions — the banners — and nothing
   * else. The eight home_rail_* logo slots and the home_mpu_1 box were removed
   * at the client's direction while that part of the page is reworked
   * (docs/HUMAN-TODO.md §14.3). That is a deliberate reduction, not drift, and
   * this test is what makes it visible if someone changes it again in either
   * direction.
   */
  it("carries exactly the advert inventory the design ships with", () => {
    const keys = slotKeys(GridHome(homeData()));
    expect(keys.sort()).toEqual(["home_1", "home_2", "home_3"]);
    // Every key appears once: a slot dealt into two positions would bill one
    // booking twice on a single page load.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never places the same story twice across the page's sections", () => {
    const stories = Array.from({ length: 8 }, (_, i) => story({ id: `s${i}`, slug: `s${i}`, title: `Story ${i}` }));
    // The first two also sit in memberNews — the member-news row must skip
    // anything the highlights above it already used.
    const tree = GridHome(homeData({ stories, memberNews: [stories[0], stories[1], story({ id: "m9", slug: "m9", title: "Member nine" })] }));
    const hrefs: string[] = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!isValidElement(node)) return;
      const props = node.props as { story?: StoryCardType; children?: ReactNode };
      if (props.story) hrefs.push(props.story.id);
      walk(props.children);
    };
    walk(tree);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain("m9");
  });
});
