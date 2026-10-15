// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberBacklink } from "@/components/MemberBacklink";
import { MemberTiles } from "@/components/MemberTiles";

// Jas 13/10 item 12b: a boxed area, one tile per member, the brand logo as
// large as is sensible, and wording that invites the click.
describe("MemberTiles", () => {
  const blm = { name: "BLM Group", slug: "blm-group", logoUrl: "https://cdn.test/blm.png" };
  const apt = { name: "AP&T UK Branch", slug: "apt-uk", logoUrl: null };

  it("one whole-tile link per member, in the order given", () => {
    render(<MemberTiles members={[blm, apt]} />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/member/blm-group", "/member/apt-uk"]);
    expect(links[0]).toHaveAccessibleName(/BLM Group.*Click for more member info/i);
    expect(links[0].querySelector("img")).toHaveAttribute("src", "https://cdn.test/blm.png");
  });

  it("says member or members to match the count", () => {
    const { rerender } = render(<MemberTiles members={[blm]} />);
    expect(screen.getByRole("complementary", { name: "Featured SMI member" })).toBeInTheDocument();
    rerender(<MemberTiles members={[blm, apt]} />);
    expect(screen.getByRole("complementary", { name: "Featured SMI members" })).toBeInTheDocument();
  });

  it("sets the name large in place of a missing logo", () => {
    render(<MemberTiles members={[apt]} />);
    expect(screen.getByRole("link").querySelector("img")).toBeNull();
    expect(screen.getAllByText("AP&T UK Branch")).toHaveLength(2);
  });

  it("renders nothing for no members", () => {
    const { container } = render(<MemberTiles members={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MemberBacklink", () => {
  it("is the single-member box, still linking to the member's page", () => {
    render(<MemberBacklink name="Acme Fabrication" slug="acme" logoUrl={null} />);
    expect(screen.getByRole("link", { name: /Acme Fabrication/ })).toHaveAttribute("href", "/member/acme");
  });

  it("renders a logo only when a logoUrl is given", () => {
    const { container, rerender } = render(<MemberBacklink name="Acme" slug="acme" logoUrl="https://cdn.test/acme.png" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.test/acme.png");
    rerender(<MemberBacklink name="Acme" slug="acme" logoUrl={null} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
