// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IndustryBar } from "@/components/IndustryBar";

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
