// @vitest-environment jsdom
import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DEFAULT_HOME_SECTIONS } from "@/lib/home-sections";
import { ClassicHomeView } from "@/components/classic/ClassicHomeView";
import { GridHome } from "@/app/(public)/home.grid";
import type { HomeData } from "@/app/(public)/home.data";
import type { StoryCard as StoryCardType } from "@/lib/queries";
import { resetDbServerMocks } from "../../stubs/db-server";

/**
 * Seam 2 of the Classic design option (#68, #73): the Classic home view.
 * Prior art: tests/unit/home-grid.test.tsx, which covers Current's GridHome.
 */

vi.mock("@/lib/db/server", () => import("../../stubs/db-server"));
// NewsletterSignup (in the newsletter panel) imports the public server actions.
vi.mock("@/app/(public)/actions", () => ({ subscribeNewsletter: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => null) }));

const story = (i: number, over: Partial<StoryCardType> = {}): StoryCardType => ({
  id: `s${i}`,
  slug: `s${i}`,
  title: `Story ${i}`,
  excerpt: null,
  cover_path: null,
  cover_focus: null,
  published_at: "2026-07-14T09:00:00Z",
  is_member_news: false,
  member: null,
  ...over,
} as StoryCardType);

const stories = (n: number) => Array.from({ length: n }, (_, i) => story(i));

const homeData = (over: Partial<HomeData> = {}): HomeData => ({
  heroItems: [],
  stories: [],
  memberNews: [],
  videos: [],
  events: [],
  featuredMembers: [],
  featuredMachine: undefined,
  featuredEvent: null,
  newsletters: [],
  directory: [],
  memberCount: 0,
  storyTotal: 0,
  reach: null,
  categories: [],
  adverts: { banner: [], banner_narrow: [], supplier_logo: [], skyscraper: [], mpu: [], in_feed: [] },
  showPlaceholders: true,
  homeSections: DEFAULT_HOME_SECTIONS,
  ...over,
} as unknown as HomeData);

afterEach(() => {
  resetDbServerMocks();
  vi.clearAllMocks();
});

describe("ClassicHomeView: the Newsroom", () => {
  it("shows the first four stories, in order, ranked #1 to #4", () => {
    render(<ClassicHomeView {...homeData({ stories: stories(10) })} />);
    const newsroom = screen.getByRole("region", { name: "Newsroom" });
    const tiles = within(newsroom).getAllByRole("listitem");
    expect(tiles).toHaveLength(4);
    tiles.forEach((tile, i) => {
      expect(tile).toHaveTextContent(`#${i + 1}`);
      expect(within(tile).getByRole("link", { name: new RegExp(`Story ${i}\\b`) })).toHaveAttribute("href", `/news/s${i}`);
    });
  });
});

/**
 * A full day's content: enough stories to fill every section on both views,
 * member news, every kind of placement, and all three section rows.
 */
const fullDay = () => homeData({
  stories: stories(18),
  memberNews: ["m1", "m2", "m3", "m4"].map((id) => story(0, { id, slug: id, title: `Member ${id}`, is_member_news: true })),
  videos: Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, slug: `v${i}`, title: `Video ${i}`, url: "https://example.com/v", thumbnail_path: null })) as never,
  events: ["a", "b", "c", "d"].map((slug) => ({ slug, title: `Event ${slug}`, location: null, starts_on: "2026-12-01" })) as never,
  featuredEvent: { slug: "b", title: "Event b", location: null, starts_on: "2026-12-01" } as never,
  featuredMachine: { machine: { name: "Press brake", description: null, image_path: null, member: null } } as never,
  featuredMembers: [
    { member: { slug: "acme", name: "Acme", logo_path: null, description: null, industry: { name: "Laser" } } },
    { member: { slug: "acme", name: "Acme", logo_path: null, description: null, industry: { name: "Laser" } } },
    { member: { slug: "bradley", name: "Bradley", logo_path: null, description: null, industry: null } },
    { member: null },
  ] as never,
  newsletters: [9, 8, 7].map((number) => ({ number, subject: `Issue ${number}`, intro: null, web_slug: `n${number}`, sent_at: null })) as never,
});

/** Every link target on the rendered page. */
const hrefsOf = (container: HTMLElement) => new Set([...container.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));

/** Every AdSlot's slotKey in a returned element tree (prior art: home-grid.test.tsx). */
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

describe("ClassicHomeView: nothing Current shows is dropped", () => {
  it("links to every story, member, video, event, issue and placement that Current links to", () => {
    const data = fullDay();
    const current = hrefsOf(render(<GridHome {...data} />).container);
    const classic = hrefsOf(render(<ClassicHomeView {...data} />).container);
    // Sanity: the fixture really does reach every kind of card on Current.
    for (const href of ["/news/s0", "/news/s7", "/member/acme", "/member/bradley", "/video/v0", "/event/b", "/event/a", "/newsletters/n9", "/featured-machine"]) {
      expect(current).toContain(href);
    }
    expect([...current].filter((href) => !classic.has(href))).toEqual([]);
  });

  it("shows exactly the stories Current shows, no more and no fewer", () => {
    const data = fullDay();
    const storyLinks = (container: HTMLElement) =>
      [...hrefsOf(container)].filter((href): href is string => Boolean(href?.startsWith("/news/"))).sort();
    const current = storyLinks(render(<GridHome {...data} />).container);
    const classic = storyLinks(render(<ClassicHomeView {...data} />).container);
    // Sanity: the fixture has more stories than either view places.
    expect(current).not.toContain("/news/s17");
    expect(classic).toEqual(current);
  });

  it("carries exactly Current's three advert positions, each once", () => {
    const keys = slotKeys(ClassicHomeView(fullDay()));
    expect([...keys].sort()).toEqual(["home_1", "home_2", "home_3"]);
  });

  it("keeps the supplier logo row", () => {
    render(<ClassicHomeView {...fullDay()} />);
    expect(screen.getByRole("heading", { name: "Suppliers" })).toBeInTheDocument();
  });

  it("shows each featured member once, in a full-width row of its own", () => {
    render(<ClassicHomeView {...fullDay()} />);
    const row = screen.getByRole("heading", { name: "Featured members" }).closest("section")!;
    expect(row).toHaveAttribute("data-part", "home-featured-members");
    expect(within(row).getAllByRole("link", { name: /Featured member/ }).map((a) => a.getAttribute("href"))).toEqual(["/member/acme", "/member/bradley"]);
  });

  it("leaves the featured members row out when nothing is sold", () => {
    render(<ClassicHomeView {...homeData({ featuredMembers: [{ member: null }] as never })} />);
    expect(screen.queryByRole("heading", { name: "Featured members" })).not.toBeInTheDocument();
  });

  it("never places the same story twice", () => {
    const { container } = render(<ClassicHomeView {...fullDay()} />);
    const storyLinks = [...container.querySelectorAll('a[href^="/news/"]')]
      .map((a) => a.getAttribute("href"))
      .filter((href) => href !== "/news");
    expect(new Set(storyLinks).size).toBe(storyLinks.length);
  });
});

describe("ClassicHomeView: headings", () => {
  it("has exactly one h1, with a full day's content and with none", () => {
    const { container, unmount } = render(<ClassicHomeView {...fullDay()} />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    unmount();
    expect(render(<ClassicHomeView {...homeData()} />).container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("composes without content or adverts, and then has no empty Newsroom", () => {
    render(<ClassicHomeView {...homeData({ showPlaceholders: false })} />);
    expect(screen.queryByRole("region", { name: "Newsroom" })).not.toBeInTheDocument();
  });
});
