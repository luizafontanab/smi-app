// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PHONE_MEDIA, Wordmark } from "@/components/Wordmark";
import { AuthLogo } from "@/components/AuthLogo";

describe("Wordmark", () => {
  // Phones get the stacked lockup (the client's mobile pick), in brand orange.
  it("serves the stacked logo to phones only", () => {
    const { container } = render(<Wordmark />);
    const source = container.querySelector("picture source");
    expect(source).toHaveAttribute("media", PHONE_MEDIA);
    expect(source?.getAttribute("srcset")).toContain("logo-stacked.png");
  });

  // The exact complement of Tailwind's sm (width >= 40rem): a max-width just
  // under 40rem left fractional widths matching neither.
  it("switches lockups exactly at Tailwind's sm breakpoint", () => {
    expect(PHONE_MEDIA).toBe("(width < 40rem)");
  });

  // It heads every page, so it must not wait on lazy loading.
  it("loads eagerly", () => {
    render(<Wordmark />);
    expect(screen.getByRole("img", { name: "Sheet Metal Industries" })).toHaveAttribute("loading", "eager");
  });

  it("falls back to the wide artwork, ink text on a light surface", () => {
    render(<Wordmark tone="light" />);
    expect(screen.getByRole("img", { name: "Sheet Metal Industries" })).toHaveAttribute("src", "/logo-wide-ink.svg");
  });

  it("uses the white-text wide artwork on the dark header", () => {
    render(<Wordmark />);
    expect(screen.getByRole("img", { name: "Sheet Metal Industries" })).toHaveAttribute("src", "/logo-wide.svg");
  });
});

describe("AuthLogo", () => {
  // Pinning h-10 at every width shrank the phone's stacked lockup to ~116px,
  // tagline unreadable; only the wide mark (sm up) is pinned.
  it("pins the logo height from sm up only", () => {
    render(<AuthLogo />);
    const link = screen.getByRole("link", { name: "Sheet Metal Industries home" });
    expect(link.className).toContain("sm:[&_img]:h-10");
    expect(link.className.split(" ")).not.toContain("[&_img]:h-10");
  });
});
