// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkipLink } from "@/components/SkipLink";

describe("SkipLink", () => {
  it("links to the #main landmark", () => {
    render(<SkipLink />);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });
});
