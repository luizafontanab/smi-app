// @vitest-environment jsdom
import { DEFAULT_HOME_SECTIONS } from "@/lib/home-sections";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GridHome } from "@/app/(public)/home.grid";
import {
  GhEventCard, GhFeaturedMembers, GhMoreNews, GhNewsletterCard, GhNewsletterPanel,
  GhPublicationPanel, GhStatsBand, GhStoryCard, type GhFeaturedMemberData,
} from "@/components/grid-home/cards";
import { SectionHead } from "@/components/grid-home/ui";
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

describe("GhFeaturedMembers", () => {
  const member = (over: Partial<GhFeaturedMemberData> = {}): GhFeaturedMemberData => ({
    slug: "acme",
    name: "Acme Fabrications",
    logo_path: null,
    industry: { name: "Laser cutting" },
    ...over,
  });

  it("renders one row per member, linking to the member page", () => {
    render(<GhFeaturedMembers members={[member(), member({ slug: "bradley", name: "Bradley Sheet Metal" })]} />);
    expect(screen.getByRole("link", { name: /Acme Fabrications/ })).toHaveAttribute("href", "/member/acme");
    expect(screen.getByRole("link", { name: /Bradley Sheet Metal/ })).toHaveAttribute("href", "/member/bradley");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the industry, and copes with a member that has none", () => {
    render(<GhFeaturedMembers members={[member(), member({ slug: "x", name: "No Industry Ltd", industry: null })]} />);
    expect(screen.getByText("Laser cutting")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /No Industry Ltd/ })).toBeInTheDocument();
  });

  // Paid inventory: an empty panel labelled "Featured members" reads as a
  // product nobody bought, and it would leave a dead column beside the videos.
  it("renders nothing rather than an empty panel", () => {
    const { container } = render(<GhFeaturedMembers members={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("GhStatsBand", () => {
  it("shows the join CTA to signed-out visitors, with the real counts", () => {
    render(GhStatsBand({ storyTotal: 1968, memberCount: 82 }));
    expect(screen.getByText("1,968")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Become a Member/i })).toHaveAttribute("href", "/join");
  });

  // Deliberately unlike JoinCta, which hides itself for members: this band
  // closes the page and its CTA is unconditional, so a signed-in member sees
  // it too. The band no longer reads the session at all.
  it("keeps the CTA for a signed-in member", () => {
    currentUser.mockResolvedValue({ email: "member1@smi.local" });
    render(GhStatsBand({ storyTotal: 1968, memberCount: 82 }));
    expect(screen.getByText("1,968")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Become a Member/i })).toHaveAttribute("href", "/join");
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

/** Every element of one component type in a returned tree, with its props. */
function propsOf<P>(node: ReactNode, type: unknown, found: P[] = []): P[] {
  if (Array.isArray(node)) {
    for (const child of node) propsOf(child, type, found);
    return found;
  }
  if (!isValidElement(node)) return found;
  if (node.type === type) found.push(node.props as P);
  propsOf((node.props as { children?: ReactNode }).children, type, found);
  return found;
}

const eventCards = (n: ReactNode) => propsOf<{ event: { slug: string }; featured?: boolean }>(n, GhEventCard);
const newsletterCards = (n: ReactNode) => propsOf<{ issue: { number: number } }>(n, GhNewsletterCard).map((p) => p.issue);
const sectionTitles = (n: ReactNode) => propsOf<{ title: string }>(n, SectionHead).map((p) => p.title);

/** How many times a given component appears in a returned element tree. */
function countOf(node: ReactNode, type: unknown): number {
  if (Array.isArray(node)) return node.reduce<number>((n, child) => n + countOf(child, type), 0);
  if (!isValidElement(node)) return 0;
  const props = node.props as { children?: ReactNode };
  return (node.type === type ? 1 : 0) + countOf(props.children, type);
}

/** Every className string in a returned element tree, joined. */
function classNames(node: ReactNode, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) classNames(child, found);
    return found;
  }
  if (!isValidElement(node)) return found;
  const props = node.props as { className?: string; children?: ReactNode };
  if (typeof props.className === "string") found.push(props.className);
  classNames(props.children, found);
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
  adverts: { banner: [], banner_narrow: [], supplier_logo: [], skyscraper: [], mpu: [], in_feed: [] },
  showPlaceholders: true,
  homeSections: DEFAULT_HOME_SECTIONS,
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
   * This page carries THREE positions and nothing else. The eight home_rail_*
   * logo slots and the home_mpu_1 box were removed at the client's direction
   * while that part of the page is reworked (docs/HUMAN-TODO.md §14.3). That
   * is a deliberate reduction, not drift, and this test is what makes it
   * visible if someone changes it again in either direction.
   *
   * All three are the full-width banner, at the client's direction (18 Sep) —
   * home_2, not the 830×170 home_2_narrow it took for a day while it sat in
   * the column beside the Featured members box. That slot and its
   * banner_narrow format are still registered and now render nowhere
   * (docs/HUMAN-TODO.md §14.5), which is what this assertion pins down.
   */
  it("carries exactly the advert inventory the design ships with", () => {
    const keys = slotKeys(GridHome(homeData()));
    expect(keys.sort()).toEqual(["home_1", "home_2", "home_3"]);
    // Every key appears once: a slot dealt into two positions would bill one
    // booking twice on a single page load.
    expect(new Set(keys).size).toBe(keys.length);
  });

  /*
   * The Upcoming events row starts at events[1]: events[0] is the fold's
   * placement card, and the same event in both places reads as a bug. Only the
   * fold card is `featured`, which is what carries the warm border and the
   * "Featured event" label — a row of editorial events wearing a placement's
   * highlight would be a commercial signal that means nothing.
   */
  it("places the fold's event once, and the rest in the events row", () => {
    const ev = (slug: string) => ({ slug, title: `Event ${slug}`, location: null, starts_on: "2026-10-20" });
    const tree = GridHome(homeData({ events: [ev("a"), ev("b"), ev("c"), ev("d"), ev("e")] as never }));
    const cards = eventCards(tree);
    expect(cards.map((c) => c.event.slug)).toEqual(["a", "b", "c", "d"]);
    expect(cards.filter((c) => c.featured).map((c) => c.event.slug)).toEqual(["a"]);
  });

  // Both rows are gated on having something to show — an empty band with a
  // section head and nothing under it is worse than no band.
  it("drops the events and newsletter rows when there is nothing for them", () => {
    const heads = sectionTitles(GridHome(homeData()));
    expect(heads).not.toContain("Upcoming events");
    expect(heads).not.toContain("Latest newsletters");
  });

  // web_slug is nullable, and /newsletters/null is not a page. An issue
  // without one is skipped rather than rendered as a dead card.
  it("skips a newsletter issue with no page to link to", () => {
    const issue = (number: number, web_slug: string | null) => ({ number, subject: `Issue ${number}`, intro: null, web_slug, sent_at: null });
    const tree = GridHome(homeData({ newsletters: [issue(9, "nine"), issue(8, null), issue(7, "seven")] as never }));
    expect(sectionTitles(tree)).toContain("Latest newsletters");
    expect(newsletterCards(tree).map((i) => i.number)).toEqual([9, 7]);
  });

  /*
   * The newsletter signup and the magazine promo moved out of their own band
   * and into the videos band on 18 Sep, where the narrow advert used to sit.
   * Both are unconditional — no data gates them — so a move that dropped one
   * would show as an empty half-column and nothing else. Neither may appear
   * twice: two signup forms on one page means two id="…" collisions and a
   * second subscribe POST target.
   */
  it("carries the newsletter and magazine panels exactly once each", () => {
    const tree = GridHome(homeData());
    expect(countOf(tree, GhNewsletterPanel)).toBe(1);
    expect(countOf(tree, GhPublicationPanel)).toBe(1);
  });

  /*
   * The videos band splits into two columns only when there is a Featured
   * members box to put in the left one. Leaving the column definition in place
   * with no box drops the videos into the 3fr column — half-width videos beside
   * an empty gutter — so the class has to switch with the data, and one array
   * has to decide both. Asserted because the failure is silent at build time.
   */
  it("only splits the videos band into columns when a member is featured", () => {
    const placement = { member: { slug: "acme", name: "Acme", logo_path: null, industry: { name: "Laser" } } };
    const withBox = classNames(GridHome(homeData({ featuredMembers: [placement] as never }))).join(" ");
    expect(withBox).toContain("lg:grid-cols-[3fr_9fr]");

    const without = classNames(GridHome(homeData())).join(" ");
    expect(without).not.toContain("lg:grid-cols-[3fr_9fr]");
  });

  // A placement whose member row is missing (members.member_id is nullable)
  // must not count towards the box, or the page splits into two columns and
  // renders nothing in the left one.
  it("ignores a featured placement with no member attached", () => {
    const tree = GridHome(homeData({ featuredMembers: [{ member: null }] as never }));
    expect(classNames(tree).join(" ")).not.toContain("lg:grid-cols-[3fr_9fr]");
  });

  /*
   * Regression guard for a whole story going missing. The fold takes stories
   * 0-1 and the More News carousel takes the run straight after them — so the
   * ids placed on the page must be a contiguous prefix with no hole in it.
   * It caught exactly that when the Industry insight band was removed on
   * 18 Sep and its story index would otherwise have been skipped. The
   * duplicate test below cannot see an omission.
   */
  it("places a contiguous run of stories, skipping none", () => {
    const stories = Array.from({ length: 14 }, (_, i) => story({ id: `s${i}`, slug: `s${i}`, title: `Story ${i}` }));
    const placed = new Set<string>();
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!isValidElement(node)) return;
      const props = node.props as { story?: StoryCardType; stories?: StoryCardType[]; children?: ReactNode };
      if (props.story) placed.add(props.story.id);
      props.stories?.forEach((s) => placed.add(s.id));
      walk(props.children);
    };
    walk(GridHome(homeData({ stories })));
    const indexes = [...placed].map((id) => Number(id.slice(1))).sort((a, b) => a - b);
    expect(indexes).toEqual(Array.from({ length: indexes.length }, (_, i) => i));
  });

  // GAPS A9.3: member news rotates into the More News carousel near the top.
  // The industry stories placed must still be a gap-free prefix — weaving
  // only pushes out the *oldest* tiles — and the fold stays ≤2 member stories.
  it("weaves member news into the top carousel without skipping industry stories", () => {
    const stories = Array.from({ length: 14 }, (_, i) => story({ id: `s${i}`, slug: `s${i}`, title: `Story ${i}` }));
    const memberNews = ["m1", "m2", "m3"].map((id) => story({ id, slug: id, title: id, is_member_news: true }));
    const tree = GridHome(homeData({ stories, memberNews }));
    let carousel: StoryCardType[] = [];
    const placed = new Set<string>();
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!isValidElement(node)) return;
      const props = node.props as { story?: StoryCardType; stories?: StoryCardType[]; children?: ReactNode };
      if (props.story) placed.add(props.story.id);
      if (props.stories) carousel = props.stories;
      props.stories?.forEach((s) => placed.add(s.id));
      walk(props.children);
    };
    walk(tree);

    expect(carousel.filter((s) => s.is_member_news)).toHaveLength(2);
    expect(carousel[0].is_member_news).toBe(false); // it still opens on industry news
    const industry = [...placed].filter((id) => id.startsWith("s")).map((id) => Number(id.slice(1))).sort((x, y) => x - y);
    expect(industry).toEqual(Array.from({ length: industry.length }, (_, i) => i));
  });

  // GAPS A1.7: sections render in the configured order, hidden ones drop
  // out, and the banners keep their rhythm — home_2 after the first section,
  // home_3 after the last — whatever the order.
  it("renders sections in the configured order, with the banners still between content", () => {
    const tree = GridHome(homeData({
      events: Array.from({ length: 3 }, (_, i) => ({ slug: `e${i}`, title: `E${i}` })) as never,
      newsletters: [{ number: 1, subject: "N", intro: null, web_slug: "n1", sent_at: null }] as never,
      memberNews: [story({ id: "m1", slug: "m1", title: "M1", is_member_news: true })],
      homeSections: { order: ["newsletters", "events", "videos", "member_news", "supplier_logos"], hidden: ["member_news"] },
    }));
    const seq: string[] = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!isValidElement(node)) return;
      const props = node.props as { title?: string; slotKey?: string; children?: ReactNode };
      if (props.slotKey) seq.push(props.slotKey);
      else if (typeof props.title === "string" && ["Latest newsletters", "Upcoming events", "Latest videos", "Featured member news"].includes(props.title)) seq.push(props.title);
      walk(props.children);
    };
    walk(tree);
    expect(seq).toEqual(["home_1", "Latest newsletters", "home_2", "Upcoming events", "Latest videos", "home_3"]);
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
