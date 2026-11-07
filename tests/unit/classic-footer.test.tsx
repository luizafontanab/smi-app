// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { ClassicFooter } from "@/components/classic/ClassicFooter";
import { SMI_SOCIAL_URLS } from "@/lib/social";
import { SIGNUP_SURFACES } from "@/lib/newsletter-consent";
import { resetDbServerMocks } from "../stubs/db-server";

/**
 * Seam 2 of the Classic design option (#68, #72): the Classic footer reads the
 * path itself (the layout passes it nothing) and drops the "Become a Member."
 * band on the two join pages, which already ask. Everything Current's footer
 * offers stays reachable, and the sign-up records the same consent surface.
 */

// NewsletterSignup -> subscribeNewsletter -> serviceDb.
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  vi.mocked(usePathname).mockReset();
  resetDbServerMocks();
});

const band = () => screen.queryByRole("region", { name: "Become a Member." });

describe("ClassicFooter: the Become-a-Member band", () => {
  it.each(["/join", "/join/account"])("is hidden on %s", (path) => {
    vi.mocked(usePathname).mockReturnValue(path);
    render(<ClassicFooter />);
    expect(band()).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Become a Member" })).not.toBeInTheDocument();
  });

  it.each(["/", "/news", "/news/some-story", "/member", "/joinery", "/join/account/extra"])("is present on %s", (path) => {
    vi.mocked(usePathname).mockReturnValue(path);
    render(<ClassicFooter />);
    expect(band()).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Become a Member" })).toHaveAttribute("href", "/join");
  });

  it("ignores a trailing slash on the join pages", () => {
    vi.mocked(usePathname).mockReturnValue("/join/");
    render(<ClassicFooter />);
    expect(band()).not.toBeInTheDocument();
  });
});

describe("ClassicFooter: what Current's footer offers", () => {
  it("keeps every site link Current's footer has, and the cookie settings control", () => {
    render(<ClassicFooter />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    const links = [...nav.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["About", "/pages/about"],
      ["Terms", "/pages/terms"],
      ["Policies", "/pages/policies"],
      ["Membership terms", "/pages/membership-terms"],
      ["FAQ", "/pages/faq"],
      ["Contact", "/contact"],
    ]);
    expect(screen.getByRole("button", { name: "Cookie settings" })).toBeInTheDocument();
  });

  it("links each social icon to its channel, in a new tab", () => {
    render(<ClassicFooter />);
    const linkedin = screen.getByRole("link", { name: "LinkedIn" });
    expect(linkedin).toHaveAttribute("href", SMI_SOCIAL_URLS.linkedin);
    expect(linkedin).toHaveAttribute("target", "_blank");
    expect(linkedin).toHaveAttribute("rel", "noopener");
  });

  it("offers a Back to Top link to the top of the page", () => {
    render(<ClassicFooter />);
    expect(screen.getByRole("link", { name: "Back to Top" })).toHaveAttribute("href", "#top");
  });

  it("shows the current year in the legal line", () => {
    render(<ClassicFooter />);
    expect(screen.getByText(new RegExp(`©\\s*${new Date().getFullYear()}\\s*Sheet Metal Industries`))).toBeInTheDocument();
  });
});

describe("ClassicFooter: the newsletter sign-up (decisions 6 Nov, 5)", () => {
  it("records Current's footer surface and shows exactly that surface's wording", () => {
    const { container } = render(<ClassicFooter />);
    const surface = container.querySelector<HTMLInputElement>('input[type="hidden"][name="surface"]');
    expect(surface?.value).toBe("grid_footer");
    expect(screen.getByRole("heading", { name: "Monthly newsletter" })).toBeInTheDocument();
    expect(screen.getByText("UK sheet metal news, machinery launches and event dates, for free.")).toBeInTheDocument();
    expect(SIGNUP_SURFACES.grid_footer).toEqual({
      heading: "Monthly newsletter",
      blurb: "UK sheet metal news, machinery launches and event dates, for free.",
    });
    expect(screen.getByRole("textbox", { name: "Email address" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });
});
