// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ClassicIndustryView } from "@/components/classic/ClassicIndustryView";
import type { IndustryHub } from "@/lib/industry-hub";
import { resetDbServerMocks } from "../stubs/db-server";

/**
 * Seam 2 of the Classic design option (#68, #76): the Classic industry page,
 * "Topic page". Prior art: tests/unit/industry-bar.test.tsx.
 */

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  resetDbServerMocks();
  vi.clearAllMocks();
});

const story = (title: string, i: number) => ({
  id: `s${i}`, slug: `s${i}`, title, excerpt: null, cover_path: null, cover_focus: null,
  published_at: `2026-07-${String(20 - i).padStart(2, "0")}T09:00:00Z`, is_member_news: false, member: null,
});
const member = (name: string) => ({ slug: name.toLowerCase(), name, logo_path: null, industry: null });
const video = (title: string, i: number) => ({ id: `v${i}`, slug: `v${i}`, title, url: "https://youtu.be/x", thumbnail_path: null, member: null });
const event = (title: string, i: number) => ({
  slug: `e${i}`, title, location: null, starts_on: `2026-12-0${i + 1}`, starts_time: null, ends_on: null, link: null, description: null,
});

const hub = (over: Partial<IndustryHub> = {}): IndustryHub => ({
  industry: { id: 7, slug: "welding", name: "Welding" },
  stories: [], storyTotal: 0,
  members: [], memberTotal: 0,
  videos: [], videoTotal: 0,
  events: [], eventTotal: 0, eventsTense: "upcoming",
  ...over,
} as unknown as IndustryHub);

const INDUSTRIES = [
  { slug: "laser-cutting", name: "Laser Cutting" },
  { slug: "welding", name: "Welding" },
];

const sectionTitles = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("ClassicIndustryView", () => {
  it("shows the industry as the page's one h1", () => {
    render(<ClassicIndustryView slug="welding" hub={hub()} industries={INDUSTRIES} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welding");
  });

  it("leaves out every section with no entries", () => {
    render(
      <ClassicIndustryView
        slug="welding"
        hub={hub({ members: [member("Acme")], memberTotal: 1, events: [event("Expo", 0)], eventTotal: 1 } as Partial<IndustryHub>)}
        industries={INDUSTRIES}
      />,
    );
    expect(sectionTitles()).toEqual(["Members", "Upcoming events"]);
  });

  it("ends each section with its See all link, even when every entry is already shown", () => {
    render(
      <ClassicIndustryView
        slug="welding"
        hub={hub({
          stories: [story("Weld bay", 0)], storyTotal: 1,
          members: [member("Acme")], memberTotal: 1,
          videos: [video("Tour", 0)], videoTotal: 1,
          events: [event("Expo", 0)], eventTotal: 1, eventsTense: "past",
        } as Partial<IndustryHub>)}
        industries={INDUSTRIES}
      />,
    );
    const seeAll = (title: string) => {
      const section = screen.getByRole("region", { name: title });
      const links = within(section).getAllByRole("link");
      return [links.at(-1)?.textContent, links.at(-1)?.getAttribute("href")];
    };
    expect(seeAll("News")).toEqual(["See all news", "/news?industry=welding"]);
    expect(seeAll("Members")).toEqual(["See all members", "/member?industry=welding"]);
    expect(seeAll("Videos")).toEqual(["See all videos", "/video?industry=welding"]);
    expect(seeAll("Past events")).toEqual(["See all events", "/event?industry=welding"]);
  });

  it("offers every public industry under Topics, on the current one", () => {
    render(<ClassicIndustryView slug="welding" hub={hub()} industries={INDUSTRIES} />);
    const topics = screen.getByRole("combobox", { name: "Topics" });
    expect(within(topics).getAllByRole("option").map((o) => o.textContent)).toEqual(["Laser Cutting", "Welding"]);
    expect(topics).toHaveValue("welding");
  });

  // WCAG 3.2.2 (decisions 6 Nov, 18): changing a select must not change the
  // page by itself, so choosing a topic waits for the Go button.
  it("goes to the chosen industry's page on Go, not on choosing it", () => {
    render(<ClassicIndustryView slug="welding" hub={hub()} industries={INDUSTRIES} />);
    const topics = screen.getByRole("combobox", { name: "Topics" });

    fireEvent.change(topics, { target: { value: "laser-cutting" } });
    expect(topics).toHaveValue("laser-cutting");
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(push).toHaveBeenCalledWith("/industry/laser-cutting");
  });

  it("still names the current industry under Topics when the route passes no list", () => {
    render(<ClassicIndustryView slug="welding" hub={hub()} />);
    const topics = screen.getByRole("combobox", { name: "Topics" });
    expect(within(topics).getAllByRole("option").map((o) => o.textContent)).toEqual(["Welding"]);
  });

  it("sorts each section's cards by Most recent (the order they arrive in) or A–Z, without leaving the page", () => {
    render(
      <ClassicIndustryView
        slug="welding"
        hub={hub({
          stories: [story("Weld bay", 0), story("Arc news", 1), story("mig tips", 2)], storyTotal: 3,
          members: [member("Zeta"), member("Acme")], memberTotal: 2,
        } as Partial<IndustryHub>)}
        industries={INDUSTRIES}
      />,
    );
    const titles = (section: string) =>
      within(screen.getByRole("region", { name: section })).getAllByRole("listitem").map((li) => li.textContent);
    const sort = screen.getByRole("combobox", { name: "Sort By" });
    expect(within(sort).getAllByRole("option").map((o) => o.textContent)).toEqual(["Most recent", "A–Z"]);
    expect(sort).toHaveValue("recent");
    expect(titles("News")).toEqual([expect.stringContaining("Weld bay"), expect.stringContaining("Arc news"), expect.stringContaining("mig tips")]);
    expect(titles("Members")).toEqual([expect.stringContaining("Zeta"), expect.stringContaining("Acme")]);

    fireEvent.change(sort, { target: { value: "az" } });
    expect(titles("News")).toEqual([expect.stringContaining("Arc news"), expect.stringContaining("mig tips"), expect.stringContaining("Weld bay")]);
    expect(titles("Members")).toEqual([expect.stringContaining("Acme"), expect.stringContaining("Zeta")]);
    expect(push).not.toHaveBeenCalled();
  });

  it("says so, and leaves the Topics select as the way on, when nothing is tagged with the industry", () => {
    render(<ClassicIndustryView slug="welding" hub={hub()} industries={INDUSTRIES} />);
    expect(sectionTitles()).toEqual([]);
    expect(screen.getByText("Nothing is tagged Welding yet.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Topics" })).toBeInTheDocument();
  });
});
