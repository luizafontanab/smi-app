// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ClassicJoinView } from "@/components/classic/ClassicJoinView";
import { JoinPageView } from "@/components/join/JoinPageView";

/**
 * Seam 2 of the Classic design option (#68, #78): the Classic join page,
 * "Hybrid". Prior art: tests/unit/join-cta.test.tsx.
 */

const page = () => render(<ClassicJoinView />);
const squash = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();

describe("ClassicJoinView", () => {
  it("opens with a banner carrying the page's one heading, Become a Member", () => {
    const { container } = page();
    const banner = container.querySelector('[data-part="join-banner"]');
    expect(banner).not.toBeNull();
    expect(within(banner as HTMLElement).getByRole("heading", { level: 1 })).toHaveTextContent("Become a Member");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("puts the price, a Join now button into the join flow and the Stripe note together in one panel", () => {
    const { container } = page();
    const panel = container.querySelector('[data-part="join-price-panel"]') as HTMLElement | null;
    expect(panel).not.toBeNull();
    const inPanel = within(panel as HTMLElement);
    expect(inPanel.getByText("£40/month")).toBeInTheDocument();
    expect(inPanel.getByRole("link", { name: "Join now — £40/month" })).toHaveAttribute("href", "/join/account");
    expect(inPanel.getByText("Payments handled securely by Stripe.")).toBeInTheDocument();
  });

  it("explains how joining works beside the price, in Current's four steps", () => {
    const { container } = page();
    const steps = container.querySelector('[data-part="join-price-panel"] [data-part="join-steps"]') as HTMLElement | null;
    expect(steps).not.toBeNull();
    expect(within(steps as HTMLElement).getByRole("heading", { level: 2, name: "How joining works" })).toBeInTheDocument();
    expect(within(steps as HTMLElement).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1Create your account — Company name, email, password — two minutes.",
      "2Pay £40/month — Card via Stripe, or redeem a promo code.",
      "3Build your draft page — Describe your company; we auto-fill what we know.",
      "4We verify and approve — The editor checks your page — then you're live in the directory.",
    ]);
  });

  it("keeps every heading, paragraph and step of Current's join page, word for word", () => {
    const current = render(<JoinPageView />).container;
    const copy = [...current.querySelectorAll("h1, h2, h3, p, li")].map((el) => squash(el.textContent));
    expect(copy.length).toBeGreaterThan(10); // a selector that found nothing would pass anything
    current.remove();

    const classic = squash(page().container.textContent);
    for (const line of copy) expect(classic, line).toContain(line);
  });

  it("shows the four benefits as panels, each titled, with a decorative disc", () => {
    const { container } = page();
    const benefits = [...container.querySelectorAll('[data-part="join-benefit"]')] as HTMLElement[];
    expect(benefits.map((b) => within(b).getByRole("heading", { level: 3 }).textContent)).toEqual([
      "Your company page", "Post your own news", "See your reach", "Community",
    ]);
    for (const b of benefits) {
      expect(b.querySelector('[data-part="join-benefit-disc"]')).toHaveAttribute("aria-hidden", "true");
    }
  });

  // The glyphs are keyed by benefit title, so renaming a benefit on staging
  // must not leave its disc empty.
  it("gives every benefit's disc a glyph", () => {
    const { container } = page();
    const discs = [...container.querySelectorAll('[data-part="join-benefit-disc"]')];
    expect(discs).toHaveLength(4);
    for (const d of discs) expect(d.textContent).not.toBe("");
  });

  it("uses no photo in the banner yet: a marked placeholder, never a borrowed story cover", () => {
    const { container } = page();
    expect(container.querySelector('[data-part="join-banner"] img')).toBeNull();
  });
});
