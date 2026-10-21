// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { newsletterBySlug, issueExtras } = vi.hoisted(() => ({
  newsletterBySlug: vi.fn(),
  issueExtras: vi.fn(async (): Promise<unknown> => ({ events: [], directory: [] })),
}));
vi.mock("@/lib/queries", () => ({ newsletterBySlug }));
vi.mock("@/lib/newsletter-extras", () => ({ issueExtras }));
vi.mock("@/lib/analytics", () => ({ record: vi.fn(), requestContext: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

import NewsletterIssuePage from "@/app/(public)/newsletters/[slug]/page";

afterEach(() => {
  vi.clearAllMocks();
  issueExtras.mockResolvedValue({ events: [], directory: [] });
});

const props = { params: Promise.resolve({ slug: "issue-50" }), searchParams: Promise.resolve({}) } as never;
const story = (n: number) => ({
  position: n,
  story: { slug: `story-${n}`, title: `Story ${n}`, excerpt: null, cover_path: null, cover_focus: null },
  video: null,
});

describe("/newsletters/[slug] (gap review area 5)", () => {
  it("lays the web copy out like the email: sponsor, lead, heading, videos and adverts between rows", async () => {
    newsletterBySlug.mockResolvedValue({
      id: "iss1", number: 50, subject: "November", intro: null, sent_at: null,
      items: [
        story(0),
        { position: 1, story: null, video: { slug: "demo", title: "Demo video", thumbnail_path: null } },
        story(2),
        story(3),
        // withdrawn since the send — RLS hides it
        { position: 4, story: null, video: null },
      ],
      ads: [
        { position: 0, after_item: null, advert: { id: "ad1", name: "Amada", format: "newsletter_banner", desktop_path: null, mobile_path: "amada.jpg" } },
        { position: 1, after_item: null, advert: { id: "logo1", name: "Greenfield", format: "association_logo", desktop_path: "g.png", mobile_path: null } },
      ],
    });

    const { container } = render(await NewsletterIssuePage(props));

    expect(screen.getByText("In association with")).toBeInTheDocument();
    expect(screen.getByAltText("Greenfield").closest("a")).toHaveAttribute("href", "/visit/logo1?src=newsletter");
    expect(screen.getByRole("heading", { name: "Sheeting Hot News" })).toBeInTheDocument();
    expect(screen.getByText("Demo video").closest("a")).toHaveAttribute("href", "/video/demo");
    expect(screen.getByAltText("Amada").closest("a")).toHaveAttribute("href", "/visit/ad1?src=newsletter");
    expect(screen.getByText("Sponsored")).toBeInTheDocument();

    // The advert comes after item 3 (the lead and the first row), before item 4.
    const text = container.textContent ?? "";
    expect(text.indexOf("Story 2")).toBeLessThan(text.indexOf("Sponsored"));
    expect(text.indexOf("Sponsored")).toBeLessThan(text.indexOf("Story 3"));
  });

  it("has no sponsor strip or advert label for an issue without them", async () => {
    newsletterBySlug.mockResolvedValue({ id: "iss1", number: 50, subject: "November", intro: null, sent_at: null, items: [story(0)], ads: [] });

    render(await NewsletterIssuePage(props));

    expect(screen.queryByText("In association with")).toBeNull();
    expect(screen.queryByText("Sponsored")).toBeNull();
    expect(screen.getByText("Story 0")).toBeInTheDocument();
  });

  it("shows the sponsored story, events diary and supplier directory like the email", async () => {
    newsletterBySlug.mockResolvedValue({
      id: "iss1", number: 50, subject: "November", intro: null, sent_at: "2026-11-03T09:00:00Z", scheduled_at: null,
      items: [story(0)],
      ads: [{ position: 0, after_item: null, advert: { id: "sp1", name: "Bystronic", format: "sponsored_story", desktop_path: "sp.jpg", mobile_path: "sp.jpg", headline: "Faster bending", body: "Up to eighty words." } }],
    });
    issueExtras.mockResolvedValue({
      events: [{ slug: "euroblech", title: "EuroBLECH", starts_on: "2026-11-10", ends_on: null, location: "Hanover" }],
      directory: [{ slug: "amada", name: "Amada", logo_path: null }],
    });

    render(await NewsletterIssuePage(props));

    expect(issueExtras).toHaveBeenCalledWith("iss1", "2026-11-03T09:00:00Z");
    expect(screen.getByText("Faster bending").closest("a")).toHaveAttribute("href", "/visit/sp1?src=newsletter");
    expect(screen.getByText("Sponsored")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Events diary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "EuroBLECH" })).toHaveAttribute("href", "/event/euroblech");
    expect(screen.getByText("10 November")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Amada" })).toHaveAttribute("href", "/member/amada");
  });
});
