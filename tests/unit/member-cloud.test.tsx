// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberCloud, type CloudMember } from "@/components/MemberCloud";

/**
 * Geometry is not tested here — it lives in the pure packer
 * (tests/unit/cloud-layout.test.ts), because jsdom has no layout engine and
 * every rect it reports is zero. What this file asserts is the contract the
 * markup owes the rest of the app: link shape, the featured treatment, the
 * custom properties the CSS reads, and the card staying out of the
 * accessibility tree.
 */

const members = (count: number, featured = 2): CloudMember[] =>
  Array.from({ length: count }, (_, i) => ({
    slug: `member-${i}`,
    name: `Member ${i} Fabrication`,
    logoUrl: i % 3 === 0 ? null : `https://cdn.test/media/logo-${i}.webp`,
    featured: i < featured,
  }));

const itemFor = (container: HTMLElement, slug: string) =>
  container.querySelector<HTMLElement>(`li.cloud-item:has(a[href="/member/${slug}"])`);

describe("MemberCloud", () => {
  it("links every member with no trailing slash", () => {
    // e2e selects a[href^='/member/'] and a trailing slash silently breaks it.
    render(<MemberCloud members={members(6)} seed="s" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(6);
    links.forEach((a) => expect(a.getAttribute("href")).toMatch(/^\/member\/[^/]+$/));
  });

  it("renders nothing at all when the filters match no one", () => {
    // The page owns the "No members found." message, not the component.
    const { container } = render(<MemberCloud members={[]} seed="s" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks featured members, and only them", () => {
    const { container } = render(<MemberCloud members={members(8, 3)} seed="s" />);
    expect(itemFor(container, "member-0")).toHaveAttribute("data-featured", "true");
    expect(itemFor(container, "member-2")).toHaveAttribute("data-featured", "true");
    expect(itemFor(container, "member-3")).not.toHaveAttribute("data-featured");
  });

  it("writes both packings onto every item as finite custom properties", () => {
    // The wide set drives desktop, the narrow set is swapped in by a media
    // query — so a missing narrow var means a collapsed cloud on a phone.
    const { container } = render(<MemberCloud members={members(10)} seed="s" />);
    const item = itemFor(container, "member-4")!;
    ["--x", "--y", "--s", "--cx", "--cy", "--xn", "--yn", "--sn", "--cxn", "--cyn"].forEach((prop) => {
      const value = Number(item.style.getPropertyValue(prop));
      expect(Number.isFinite(value), `${prop} is "${item.style.getPropertyValue(prop)}"`).toBe(true);
    });
  });

  it("tabs alphabetically even though it is drawn in seeded order", () => {
    const unsorted: CloudMember[] = [
      { slug: "c", name: "Charlie Metalwork", logoUrl: null, featured: false },
      { slug: "a", name: "Alpha Fabrication", logoUrl: null, featured: false },
      { slug: "b", name: "Bravo Tooling", logoUrl: null, featured: false },
    ];
    render(<MemberCloud members={unsorted} seed="s" />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Alpha Fabrication",
      "Bravo Tooling",
      "Charlie Metalwork",
    ]);
  });

  it("keeps the packer's own ordering reachable from the DOM", () => {
    // The refine pass maps the alphabetical DOM back to the seeded packing
    // order through data-i; without it every name would be repositioned onto
    // some other member's coordinates.
    const { container } = render(<MemberCloud members={members(5)} seed="s" />);
    const indices = [...container.querySelectorAll<HTMLElement>("li.cloud-item")].map((li) => Number(li.dataset.i));
    expect([...indices].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("falls back to the gear glyph rather than a broken image", () => {
    const { container } = render(<MemberCloud members={members(3)} seed="s" />);
    const withoutLogo = itemFor(container, "member-0")!;
    expect(withoutLogo.querySelector("img")).toBeNull();
    expect(withoutLogo.textContent).toContain("⚙");
    expect(itemFor(container, "member-1")!.querySelector("img")).not.toBeNull();
  });

  it("keeps the logo card out of the accessibility tree", () => {
    // The link already carries the member's name; a decorative logo must not
    // repeat it, and axe must find no text to contrast-check inside the card.
    const { container } = render(<MemberCloud members={members(4)} seed="s" />);
    const card = itemFor(container, "member-1")!.querySelector(".cloud-card")!;
    expect(card).toHaveAttribute("aria-hidden", "true");
    expect(card.textContent).toBe("");
    expect(card.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("is stable for a seed and relaid for a new one", () => {
    const list = members(12);
    const a = render(<MemberCloud members={list} seed="2026-09-17||" />);
    const first = itemFor(a.container, "member-5")!.style.getPropertyValue("--x");
    a.unmount();

    const b = render(<MemberCloud members={list} seed="2026-09-17||" />);
    expect(itemFor(b.container, "member-5")!.style.getPropertyValue("--x")).toBe(first);
    b.unmount();

    const c = render(<MemberCloud members={list} seed="2026-09-18||" />);
    expect(itemFor(c.container, "member-5")!.style.getPropertyValue("--x")).not.toBe(first);
  });
});
