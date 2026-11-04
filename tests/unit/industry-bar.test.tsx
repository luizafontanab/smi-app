// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IndustryBar, balancedBreaks } from "@/components/IndustryBar";
import { INDUSTRIES as JAS_TEN } from "../../scripts/lib/industries";

const INDUSTRIES = [
  { slug: "laser-cutting", name: "Laser Cutting" },
  { slug: "welding", name: "Welding" },
];

describe("IndustryBar", () => {
  it("renders a labelled nav with one industry-page link per category", () => {
    render(<IndustryBar industries={INDUSTRIES} />);
    const nav = screen.getByRole("navigation", { name: "Industries" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Laser Cutting" })).toHaveAttribute("href", "/industry/laser-cutting");
    expect(screen.getByRole("link", { name: "Welding" })).toHaveAttribute("href", "/industry/welding");
  });

  it("renders nothing at all for an empty list", () => {
    const { container } = render(<IndustryBar industries={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("balancedBreaks", () => {
  it("splits Jas's ten five and five for two rows — the most even break by name length", () => {
    expect(balancedBreaks(JAS_TEN, 2)).toEqual([5]);
  });

  it("splits them three, three, four for a tablet's three rows (the last four are the short names)", () => {
    expect(balancedBreaks(JAS_TEN, 3)).toEqual([3, 6]);
  });

  it("follows the names, not the count: one long name can sit alone", () => {
    expect(balancedBreaks(["A very long industry name indeed", "Short", "Tiny", "Wee"], 2)).toEqual([1]);
  });

  it("never breaks before the first name or leaves an empty row", () => {
    expect(balancedBreaks(["Welding"], 2)).toEqual([]);
    expect(balancedBreaks(["Welding", "Bending"], 3)).toEqual([1]);
  });
});

describe("IndustryBar rows", () => {
  // Tablets scroll one row like phones since #33, so the only breaks are lg's.
  it("renders the two-row break before Software & IT Services and no other, keeping every link in order", () => {
    const list = JAS_TEN.map((name) => ({ slug: name.toLowerCase(), name }));
    const { container } = render(<IndustryBar industries={list} />);
    const next = (sel: string) => [...container.querySelectorAll(sel)].map((b) => b.nextElementSibling?.textContent);
    expect(next("span.basis-full")).toEqual(["Software & IT Services"]);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([...JAS_TEN]);
  });
});
