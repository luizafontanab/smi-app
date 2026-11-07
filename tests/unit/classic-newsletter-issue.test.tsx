// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ClassicNewsletterIssueView } from "@/components/classic/ClassicNewsletterIssueView";
import type { NewsletterIssue, NewsletterIssueExtras } from "@/components/newsletter/NewsletterIssueView";

import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

/**
 * Seam 2 of the Classic design option (#68, #77): Classic's newsletter issue
 * page, the "Article shape", rendered with the same props as Current's
 * NewsletterIssueView. The fixture is an issue with everything the local seed
 * issues lack: a banner advert, a sponsored story, a masthead sponsor, an
 * events diary and a supplier directory.
 */

const story = (n: number) => ({
  position: n,
  story: { slug: `story-${n}`, title: `Story ${n}`, excerpt: `Summary ${n}`, cover_path: null, cover_focus: null },
  video: null,
});

const fullIssue = {
  id: "iss1", number: 50, subject: "November news", intro: "This month in sheet metal.",
  sent_at: "2026-11-03T09:00:00Z", scheduled_at: null,
  items: [
    story(0),
    { position: 1, story: null, video: { slug: "demo", title: "Demo video", thumbnail_path: null } },
    story(2),
    story(3),
    story(4),
    // withdrawn since the send: RLS hides it and it is skipped
    { position: 5, story: null, video: null },
  ],
  ads: [
    { position: 0, after_item: 1, advert: { id: "sp1", name: "Bystronic", format: "sponsored_story", desktop_path: "sp.jpg", mobile_path: null, headline: "Faster bending", body: "Up to eighty words." } },
    { position: 1, after_item: 3, advert: { id: "ad1", name: "Amada", format: "newsletter_banner", desktop_path: null, mobile_path: "amada.jpg", headline: null, body: null } },
    { position: 2, after_item: null, advert: { id: "logo1", name: "Greenfield", format: "association_logo", desktop_path: "g.png", mobile_path: null, headline: null, body: null } },
  ],
} as unknown as NewsletterIssue;

const fullExtras: NewsletterIssueExtras = {
  events: [{ slug: "euroblech", title: "EuroBLECH", starts_on: "2026-11-10", ends_on: "2026-11-13", location: "Hanover" }],
  directory: [{ slug: "amada", name: "Amada UK", logo_path: null }],
} as NewsletterIssueExtras;

const noExtras = { events: [], directory: [] } as NewsletterIssueExtras;

/** The issue's run of entries in block order, each read as its visible text: list items, adverts and the heading. */
function entries() {
  const run = screen.getByRole("group", { name: "In this issue" });
  return [...run.children].flatMap((child) => (child.tagName === "OL" ? [...child.children] : [child])).map((el) => el.textContent ?? "");
}

describe("Classic newsletter issue", () => {
  it("numbers the stories and videos #1–#n in the email's order, with adverts and the section heading unnumbered in their places", () => {
    render(<ClassicNewsletterIssueView issue={fullIssue} extras={noExtras} />);

    const list = entries();
    expect(list).toHaveLength(8);
    expect(list[0]).toMatch(/^#1\s*Story 0/);
    // after_item 1: the sponsored story follows the lead
    expect(list[1]).toContain("Faster bending");
    expect(list[1]).not.toMatch(/#\d/);
    // then the email's heading over the rest
    expect(list[2]).toBe("Sheeting Hot News");
    expect(list[3]).toMatch(/^#2\s*Video\s*Demo video/);
    expect(list[4]).toMatch(/^#3\s*Story 2/);
    // after_item 3: the banner follows the third item
    expect(list[5]).toContain("Sponsored");
    expect(list[5]).not.toMatch(/#\d/);
    expect(list[6]).toMatch(/^#4\s*Story 3/);
    expect(list[7]).toMatch(/^#5\s*Story 4/);
  });

  // A screen reader counts list items, so only the numbered entries are list
  // items: each run of them is its own <ol>, starting at its first number, and
  // the adverts and the heading sit between the runs (#68 review).
  it("lists only the numbered entries, in runs that start at their own number", () => {
    render(<ClassicNewsletterIssueView issue={fullIssue} extras={noExtras} />);

    const lists = within(screen.getByRole("group", { name: "In this issue" })).getAllByRole("list");
    expect(lists.map((ol) => ol.getAttribute("start") ?? "1")).toEqual(["1", "2", "4"]);
    const items = lists.flatMap((ol) => within(ol).getAllByRole("listitem"));
    expect(items.map((li) => li.textContent?.match(/^#\d+/)?.[0])).toEqual(["#1", "#2", "#3", "#4", "#5"]);
  });

  it("keeps Current's advert handling: a sponsored story stays a story, a banner stays a banner, both routed through /visit", () => {
    render(<ClassicNewsletterIssueView issue={fullIssue} extras={noExtras} />);

    const [sponsored, banner] = screen.getAllByText("Sponsored");
    // the sponsored story's copy is kept, under its label, linking out like the email
    expect(sponsored.closest("a")).toHaveAttribute("href", "/visit/sp1?src=newsletter");
    expect(screen.getByText("Faster bending").closest("a")).toHaveAttribute("href", "/visit/sp1?src=newsletter");
    expect(screen.getByText("Up to eighty words.")).toBeInTheDocument();
    // the banner is its artwork
    expect(banner.closest("a")).toBeNull();
    expect(screen.getByAltText("Amada").closest("a")).toHaveAttribute("href", "/visit/ad1?src=newsletter");
    // the association logo goes in the masthead, not the list
    expect(screen.getByText("In association with")).toBeInTheDocument();
    expect(screen.getByAltText("Greenfield").closest("a")).toHaveAttribute("href", "/visit/logo1?src=newsletter");
    expect(entries().join(" ")).not.toContain("Greenfield");
  });

  it("heads the panel with the back link, the issue line with its month, the title and the intro", () => {
    render(<ClassicNewsletterIssueView issue={fullIssue} extras={noExtras} />);

    expect(screen.getByRole("link", { name: "‹ Back to Newsletters" })).toHaveAttribute("href", "/newsletters");
    expect(screen.getByText("SMI Monthly · Issue 50 · November 2026")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "November news" })).toBeInTheDocument();
    expect(screen.getByText("This month in sheet metal.")).toBeInTheDocument();
  });

  it("shows the events diary and supplier directory when they have entries", () => {
    render(<ClassicNewsletterIssueView issue={fullIssue} extras={fullExtras} />);

    expect(screen.getByRole("heading", { level: 2, name: "Events diary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "EuroBLECH" })).toHaveAttribute("href", "/event/euroblech");
    expect(screen.getByText("10–13 November")).toBeInTheDocument();
    expect(screen.getByText("Hanover")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Supplier directory" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Amada UK" })).toHaveAttribute("href", "/member/amada");
  });

  it("leaves out an empty events diary or supplier directory", () => {
    const { rerender } = render(<ClassicNewsletterIssueView issue={fullIssue} extras={noExtras} />);
    expect(screen.queryByRole("heading", { name: "Events diary" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Supplier directory" })).toBeNull();

    rerender(<ClassicNewsletterIssueView issue={fullIssue} extras={{ ...fullExtras, events: [] }} />);
    expect(screen.queryByRole("heading", { name: "Events diary" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Supplier directory" })).toBeInTheDocument();

    rerender(<ClassicNewsletterIssueView issue={fullIssue} extras={{ ...fullExtras, directory: [] }} />);
    expect(screen.getByRole("heading", { name: "Events diary" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Supplier directory" })).toBeNull();
  });

  it("has no sponsor strip, advert or month for an unsponsored issue without a send date", () => {
    const plain = { ...fullIssue, sent_at: null, scheduled_at: null, intro: null, items: [story(0)], ads: [] } as unknown as NewsletterIssue;
    render(<ClassicNewsletterIssueView issue={plain} extras={noExtras} />);

    expect(screen.getByText("SMI Monthly · Issue 50")).toBeInTheDocument();
    expect(screen.queryByText("In association with")).toBeNull();
    expect(screen.queryByText("Sponsored")).toBeNull();
    expect(entries()).toHaveLength(1);
  });
});
