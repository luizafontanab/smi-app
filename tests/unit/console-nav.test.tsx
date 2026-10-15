// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { ConsoleNav, type NavSection } from "@/components/console/ConsoleNav";

afterEach(() => {
  vi.mocked(usePathname).mockReset();
});

const ITEMS: NavSection[] = [
  { key: "adverts", href: "/console/adverts", label: "Adverts", children: [
    { href: "/console/adverts/banners", label: "Banners" },
    { href: "/console/adverts/interest", label: "Interest" },
  ] },
  { key: "events", href: "/console/events", label: "Events" },
];

describe("ConsoleNav", () => {
  it("marks the section containing the current path as current, and shows its children", () => {
    vi.mocked(usePathname).mockReturnValue("/console/adverts/banners/123");
    render(<ConsoleNav items={ITEMS} />);
    expect(screen.getByRole("link", { name: "Adverts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Events" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Banners" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Interest" })).not.toHaveAttribute("aria-current");
  });

  it("matches a section whose href is the root itself only on an exact path", () => {
    // The member area reuses this with root="/dashboard" and an Overview
    // section pointing at /dashboard. Without the exact-match rule that
    // section would claim every page under /dashboard/.
    const items: NavSection[] = [
      { key: "overview", href: "/dashboard", label: "Overview" },
      { key: "adverts", href: "/dashboard/advert", label: "Adverts" },
    ];

    vi.mocked(usePathname).mockReturnValue("/dashboard");
    const { rerender } = render(<ConsoleNav items={items} root="/dashboard" />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

    vi.mocked(usePathname).mockReturnValue("/dashboard/advert/new");
    rerender(<ConsoleNav items={items} root="/dashboard" />);
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Adverts" })).toHaveAttribute("aria-current", "page");
  });

  it("does not let /console/adverts claim /console/advertising", () => {
    // Real pair since fix-list 74: the media pack and the public format copy
    // moved out of Adverts to Site Config → /console/advertising. A prefix
    // match without the trailing slash would light up the wrong section and
    // show the wrong sub-menu on every visit to it.
    const items: NavSection[] = [
      { key: "adverts", href: "/console/adverts", label: "Adverts", children: [
        { href: "/console/adverts", label: "Bookings" },
        { href: "/console/adverts/banners", label: "Banners" },
      ] },
      { key: "config", href: "/console/machines", label: "Site Config", children: [
        { href: "/console/advertising", label: "Advertising Page" },
      ] },
    ];

    vi.mocked(usePathname).mockReturnValue("/console/advertising");
    render(<ConsoleNav items={items} />);
    expect(screen.getByRole("link", { name: "Site Config" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Adverts" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Advertising Page" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Banners" })).not.toBeInTheDocument();
  });

  it("lights only the most specific sub-page, so a parent-path item like Bookings lets go", () => {
    const items: NavSection[] = [
      { key: "adverts", href: "/console/adverts", label: "Adverts", children: [
        { href: "/console/adverts", label: "Bookings" },
        { href: "/console/adverts/suppliers", label: "Supplier Logos" },
      ] },
    ];

    vi.mocked(usePathname).mockReturnValue("/console/adverts/suppliers/123");
    const { rerender } = render(<ConsoleNav items={items} />);
    expect(screen.getByRole("link", { name: "Supplier Logos" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Bookings" })).not.toHaveAttribute("aria-current");

    // a booking's own page matches nothing more specific, so Bookings keeps it
    vi.mocked(usePathname).mockReturnValue("/console/adverts/3f47b54d-e236-497a-931b-fbc423a97616");
    rerender(<ConsoleNav items={items} />);
    expect(screen.getByRole("link", { name: "Bookings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Supplier Logos" })).not.toHaveAttribute("aria-current");
  });

  it("shows no sub-menu items when the path matches no section", () => {
    vi.mocked(usePathname).mockReturnValue("/console/other");
    render(<ConsoleNav items={ITEMS} />);
    expect(screen.queryByRole("link", { name: "Banners" })).not.toBeInTheDocument();
  });
});
