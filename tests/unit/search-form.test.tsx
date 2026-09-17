// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SearchForm } from "@/components/SearchForm";

describe("SearchForm", () => {
  it("submits to /search with a q field", () => {
    const { container } = render(<SearchForm />);
    expect(container.querySelector("form")).toHaveAttribute("action", "/search");
    expect(screen.getByRole("searchbox", { name: "Search the site" })).toHaveAttribute("name", "q");
  });

  it("uses a custom placeholder when given one", () => {
    render(<SearchForm placeholder="Find a member…" />);
    expect(screen.getByPlaceholderText("Find a member…")).toBeInTheDocument();
  });
});
