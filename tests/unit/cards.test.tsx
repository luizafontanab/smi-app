// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventCard, FeaturedMemberCard, MachineCard, MemberTile, VideoCard } from "@/components/cards";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

describe("VideoCard", () => {
  it("prefers our own thumbnail over the YouTube fallback", () => {
    const { container } = render(
      <VideoCard
        video={{ id: "1", slug: "v1", title: "Metal Bending 101", url: "https://www.youtube.com/watch?v=abc123", thumbnail_path: "videos/v1.jpg" }}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining("videos/v1.jpg"));
  });

  it("falls back to the YouTube thumbnail when there is no stored one", () => {
    const { container } = render(<VideoCard video={{ id: "1", slug: "v1", title: "Metal Bending 101", url: "https://www.youtube.com/watch?v=abc123", thumbnail_path: null }} />);
    expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining("i.ytimg.com/vi/abc123/hqdefault.jpg"));
  });

  // "Member video", not "Member news" (fix list): VideoCard shares MemberBadge
  // with StoryCard, and before the badge took a label a member's video was
  // tagged as news.
  it("shows the member badge only for member-sourced videos", () => {
    const video = { id: "1", slug: "v1", title: "Metal Bending 101", url: "https://www.youtube.com/watch?v=abc123", thumbnail_path: null };
    const { rerender } = render(<VideoCard video={{ ...video, source: "member" }} />);
    expect(screen.getByText("Member video")).toBeInTheDocument();
    expect(screen.queryByText("Member news")).not.toBeInTheDocument();
    rerender(<VideoCard video={{ ...video, source: "staff" }} />);
    expect(screen.queryByText("Member video")).not.toBeInTheDocument();
  });
});

describe("FeaturedMemberCard", () => {
  const member = { slug: "acme", name: "Acme Fabrication", logo_path: null, description: "Precision sheet metal work." };

  it("shows the description in the card variant but not in compact", () => {
    const { rerender } = render(<FeaturedMemberCard member={member} variant="card" />);
    expect(screen.getByText("Precision sheet metal work.")).toBeInTheDocument();
    rerender(<FeaturedMemberCard member={member} variant="compact" />);
    expect(screen.queryByText("Precision sheet metal work.")).not.toBeInTheDocument();
  });

  it("band variant links to the member page and labels itself as featured", () => {
    render(<FeaturedMemberCard member={member} variant="band" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/member/acme");
    expect(screen.getByText("Featured member")).toBeInTheDocument();
  });
});

describe("MemberTile", () => {
  const member = { slug: "acme", name: "Acme Fabrication", logo_path: null, industry: { name: "Welding" } };

  it("links to the member page with no trailing slash", () => {
    render(<MemberTile member={member} />);
    // e2e selects a[href^='/member/'] — a trailing slash silently breaks it
    expect(screen.getByRole("link")).toHaveAttribute("href", "/member/acme");
  });

  it("shows the industry by default and hides it on request", () => {
    const { rerender } = render(<MemberTile member={member} />);
    expect(screen.getByText("Welding")).toBeInTheDocument();
    // off on an industry page, where every tile would repeat the same word
    rerender(<MemberTile member={member} showIndustry={false} />);
    expect(screen.queryByText("Welding")).not.toBeInTheDocument();
  });

  it("falls back to the placeholder glyph when the member has no logo", () => {
    const { container } = render(<MemberTile member={member} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("⚙")).toBeInTheDocument();
  });

  it("renders a smaller logo at sm than at the directory's default md", () => {
    const withLogo = { ...member, logo_path: "members/acme.png" };
    const { container, rerender } = render(<MemberTile member={withLogo} size="md" />);
    expect(container.querySelector("img")).toHaveAttribute("width", "112");
    rerender(<MemberTile member={withLogo} size="sm" />);
    expect(container.querySelector("img")).toHaveAttribute("width", "72");
  });
});

describe("EventCard", () => {
  const event = {
    slug: "open-day",
    title: "Open Day",
    location: "Sheffield",
    starts_on: "2026-07-01",
    starts_time: null,
    ends_on: null,
    link: "https://example.com/open-day",
    description: "<p>Come see the workshop.</p>",
    type: "open_house" as const,
    member: null,
  };

  it("formats a same-day date in UTC regardless of the local timezone", () => {
    render(<EventCard event={event} size="md" />);
    expect(screen.getByText(/1 July 2026/)).toBeInTheDocument();
  });

  it("opens the external event link in a new tab without a window handle", () => {
    render(<EventCard event={event} size="md" />);
    const external = screen.getByRole("link", { name: "Event website →" });
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener");
  });

  it("sm size omits the description and external link", () => {
    render(<EventCard event={event} size="sm" />);
    expect(screen.queryByText("Come see the workshop.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Event website →" })).not.toBeInTheDocument();
  });
});

describe("MachineCard", () => {
  it("renders an image only when the machine has one", () => {
    const base = { name: "CNC Press", description: null, member: null };
    const { container, rerender } = render(<MachineCard machine={{ ...base, image_path: "machines/cnc.jpg" }} />);
    expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining("machines/cnc.jpg"));
    rerender(<MachineCard machine={{ ...base, image_path: null }} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
