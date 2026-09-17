// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Carousel, MemberBadge, StoryCard } from "@/components/StoryCard";
import type { StoryCard as StoryCardType } from "@/lib/queries";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

function story(overrides: Partial<StoryCardType> = {}): StoryCardType {
  return {
    id: "s1",
    slug: "a-story",
    title: "A Story",
    excerpt: "The opening line.",
    cover_path: null,
    cover_focus: null,
    published_at: "2026-03-05T00:00:00Z",
    is_member_news: false,
    member: null,
    ...overrides,
  };
}

describe("StoryCard", () => {
  it("links to the story and shows a placeholder glyph without a cover", () => {
    render(<StoryCard story={story()} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/news/a-story");
    expect(screen.getByText("⚙")).toBeInTheDocument();
  });

  it("renders a real image when a cover is set", () => {
    const { container } = render(<StoryCard story={story({ cover_path: "stories/a.jpg" })} />);
    expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining("stories/a.jpg"));
  });

  it("shows the member badge only for member news", () => {
    const { rerender } = render(<StoryCard story={story({ is_member_news: true })} />);
    expect(screen.getByText("Member news")).toBeInTheDocument();
    rerender(<StoryCard story={story({ is_member_news: false })} />);
    expect(screen.queryByText("Member news")).not.toBeInTheDocument();
  });

  it("at the large size, uses the tall media box and the bigger headline", () => {
    // The lg card is the hero slot. Note the `sizes` hint the component also
    // varies by size never reaches the DOM — next/image drops it under
    // `unoptimized`, since there is no srcset for it to select from.
    const { container } = render(
      <StoryCard story={story({ cover_path: "stories/a.jpg" })} size="lg" />,
    );
    expect(container.querySelector(".h-80")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A Story" }).className).toContain("text-2xl");
  });

  it("credits the member alongside the date when the story has one", () => {
    render(
      <StoryCard
        story={story({ member: { slug: "acme", name: "Acme Fabrications", logo_path: null, status: "active" } })}
      />,
    );
    expect(screen.getByText(/Acme Fabrications/)).toBeInTheDocument();
  });

  it("hides the excerpt at the small size", () => {
    const { rerender } = render(<StoryCard story={story()} size="md" />);
    expect(screen.getByText("The opening line.")).toBeInTheDocument();
    rerender(<StoryCard story={story()} size="sm" />);
    expect(screen.queryByText("The opening line.")).not.toBeInTheDocument();
  });
});

describe("MemberBadge", () => {
  it("switches label style between overlay and inline variants", () => {
    const { rerender } = render(<MemberBadge />);
    expect(screen.getByText("Member news").className).toContain("absolute");
    rerender(<MemberBadge variant="inline" />);
    expect(screen.getByText("Member news").className).toContain("rounded-full");
  });
});

describe("Carousel", () => {
  it("renders its title and children, with an optional 'see all' link", () => {
    const { rerender } = render(
      <Carousel title="Latest">
        <p>Card one</p>
      </Carousel>,
    );
    expect(screen.getByText("Latest")).toBeInTheDocument();
    expect(screen.getByText("Card one")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See all →" })).not.toBeInTheDocument();

    rerender(
      <Carousel title="Latest" href="/news">
        <p>Card one</p>
      </Carousel>,
    );
    expect(screen.getByRole("link", { name: "See all →" })).toHaveAttribute("href", "/news");
  });
});
