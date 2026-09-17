// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberBacklink } from "@/components/MemberBacklink";

describe("MemberBacklink", () => {
  it("links to the member's page", () => {
    render(<MemberBacklink name="Acme Fabrication" slug="acme" logoUrl={null} />);
    expect(screen.getByRole("link", { name: "Acme Fabrication →" })).toHaveAttribute("href", "/member/acme");
  });

  it("renders a logo only when a logoUrl is given", () => {
    const { container, rerender } = render(<MemberBacklink name="Acme" slug="acme" logoUrl="https://cdn.test/acme.png" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.test/acme.png");
    rerender(<MemberBacklink name="Acme" slug="acme" logoUrl={null} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
