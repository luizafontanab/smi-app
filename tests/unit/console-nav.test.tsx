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
    { href: "/console/adverts/spots", label: "Spots" },
    { href: "/console/adverts/interest", label: "Interest" },
  ] },
  { key: "events", href: "/console/events", label: "Events" },
];

describe("ConsoleNav", () => {
  it("marks the section containing the current path as current, and shows its children", () => {
    vi.mocked(usePathname).mockReturnValue("/console/adverts/spots/123");
    render(<ConsoleNav items={ITEMS} />);
    expect(screen.getByRole("link", { name: "Adverts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Events" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Spots" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Interest" })).not.toHaveAttribute("aria-current");
  });

  it("shows no sub-menu items when the path matches no section", () => {
    vi.mocked(usePathname).mockReturnValue("/console/other");
    render(<ConsoleNav items={ITEMS} />);
    expect(screen.queryByRole("link", { name: "Spots" })).not.toBeInTheDocument();
  });
});
