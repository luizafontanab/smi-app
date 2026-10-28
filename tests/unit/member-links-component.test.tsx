// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemberLinks } from "@/components/MemberLinks";

const full = {
  id: "m1",
  website: "https://www.acme.co.uk",
  phone: "01234 567890",
  social: { linkedin: "company/acme-ltd", facebook: "javascript:alert(1)" },
};

describe("MemberLinks", () => {
  it("is headed Links and lists website, phone and socials as links", () => {
    render(<MemberLinks member={full} />);
    expect(screen.getByRole("heading", { name: "Links" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Website: acme\.co\.uk/ })).toHaveAttribute("href", "/go/m1?kind=website");
    expect(screen.getByRole("link", { name: "Call: 01234 567890" })).toHaveAttribute("href", "/go/m1?kind=phone");
    expect(screen.getByRole("link", { name: /^LinkedIn: acme-ltd/ })).toHaveAttribute("href", "/go/m1?kind=social&platform=linkedin");
  });

  it("opens off-site rows in a new tab without window.opener, and says so; the phone stays put", () => {
    render(<MemberLinks member={full} />);
    for (const name of [/^Website/, /^LinkedIn/]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(link).toHaveAccessibleName(/opens in a new tab/);
    }
    expect(screen.getByRole("link", { name: /^Call/ })).not.toHaveAttribute("target");
  });

  it("shows an unlinkable value as plain text, not a link", () => {
    render(<MemberLinks member={full} />);
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Facebook/ })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("hides every logo from assistive tech", () => {
    const { container } = render(<MemberLinks member={full} />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("renders nothing when the member has no links", () => {
    const { container } = render(<MemberLinks member={{ id: "m1", website: null, phone: null, social: {} }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
