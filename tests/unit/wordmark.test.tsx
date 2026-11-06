// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PHONE_MEDIA, Wordmark } from "@/components/Wordmark";
import { AuthLogo } from "@/components/AuthLogo";

describe("Wordmark", () => {
  // Phones get the stacked lockup (the client's mobile pick).
  it("serves the stacked logo to phones only", () => {
    const { container } = render(<Wordmark />);
    const source = container.querySelector("picture source");
    expect(source).toHaveAttribute("media", PHONE_MEDIA);
    expect(source?.getAttribute("srcset")).toContain("/logo-stacked.svg");
  });

  // Its ".com" is white, so a light bar needs the ink copy.
  it("serves the ink-.com stacked logo to phones on a light surface", () => {
    const { container } = render(<Wordmark tone="light" />);
    expect(container.querySelector("picture source")?.getAttribute("srcset")).toContain("/logo-stacked-ink.svg");
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

describe("stacked logo artwork", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), "public", f), "utf8").split("\n");

  // The client's rule: the approved artwork is used as supplied. The light-
  // surface copy may differ from it only by the white ".com" fill.
  it("ink copy is the approved file with only the white fill changed", () => {
    const approved = read("logo-stacked.svg");
    const ink = read("logo-stacked-ink.svg");
    expect(ink).toHaveLength(approved.length);
    const changed = approved.flatMap((line, i) => (line === ink[i] ? [] : [[line.trim(), ink[i].trim()]]));
    expect(changed).toEqual([["fill: #fff;", "fill: #111418;"]]);
  });

  // Confirmed 6 Nov: the brand orange is #ff8200 (--smi-brand). The file was
  // first exported as #f08119; a re-export must not bring that back.
  it("is in the brand orange", () => {
    const fills = read("logo-stacked.svg").join("\n").match(/#[0-9a-f]{6}\b/gi);
    expect(fills).toEqual(["#ff8200"]);
  });
});
