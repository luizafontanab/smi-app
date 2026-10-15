// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StorySocialLinks } from "@/components/StorySocialLinks";
import { SMI_SOCIAL_URLS } from "@/lib/social";

// Jas 13/10 item 8: icons linking to SMI's own posts, not share buttons.
describe("StorySocialLinks", () => {
  it("labels a pasted post as the story's post, and the rest as SMI's pages", () => {
    render(<StorySocialLinks posts={{ linkedin: "https://www.linkedin.com/posts/smi_story" }} />);
    expect(screen.getByRole("heading", { name: "View / share on our socials" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View this story on LinkedIn/ })).toHaveAttribute("href", "https://www.linkedin.com/posts/smi_story");
    expect(screen.getByRole("link", { name: /SMI on Facebook/ })).toHaveAttribute("href", SMI_SOCIAL_URLS.facebook);
    expect(screen.getByRole("link", { name: /SMI on X/ })).toHaveAttribute("href", SMI_SOCIAL_URLS.x);
  });

  it("opens off-site in a new tab without handing over window.opener, and says so", () => {
    render(<StorySocialLinks posts={null} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(link).toHaveAccessibleName(/opens in a new tab/);
    }
  });

  it("shows brand icons, hidden from assistive tech", () => {
    const { container } = render(<StorySocialLinks posts={null} />);
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3);
  });
});
