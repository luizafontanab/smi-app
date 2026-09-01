// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "@/components/SiteFooter";
import { SMI_SOCIAL_URLS } from "@/lib/social";
import { resetDbServerMocks } from "../stubs/db-server";

// NewsletterSignup -> subscribeNewsletter -> serviceDb.
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

describe("SiteFooter", () => {
  it("links each social icon to its real channel URL, opening in a new tab", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", SMI_SOCIAL_URLS.linkedin);
    const linkedin = screen.getByRole("link", { name: "LinkedIn" });
    expect(linkedin).toHaveAttribute("target", "_blank");
    expect(linkedin).toHaveAttribute("rel", "noopener");
  });

  it("shows the current year in the copyright line", () => {
    render(<SiteFooter />);
    const year = new Date().getFullYear();
    expect(screen.getByText(new RegExp(`©\\s*${year}\\s*Sheet Metal Industries`))).toBeInTheDocument();
  });

  it("includes the cookie settings control and the newsletter form", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("button", { name: "Cookie settings" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("you@company.co.uk")).toBeInTheDocument();
  });
});
