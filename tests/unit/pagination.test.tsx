// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pagination } from "@/components/Pagination";

const hrefFor = (page: number) => `/news?page=${page}`;

describe("Pagination", () => {
  it("renders nothing for a single page", () => {
    const { container } = render(<Pagination page={1} pages={1} hrefFor={hrefFor} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides Prev on the first page", () => {
    render(<Pagination page={1} pages={3} hrefFor={hrefFor} />);
    expect(screen.queryByRole("link", { name: "← Prev" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next →" })).toHaveAttribute("href", "/news?page=2");
  });

  it("hides Next on the last page", () => {
    render(<Pagination page={3} pages={3} hrefFor={hrefFor} />);
    expect(screen.queryByRole("link", { name: "Next →" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Prev" })).toHaveAttribute("href", "/news?page=2");
  });

  it("shows both links and the page count on a middle page", () => {
    render(<Pagination page={2} pages={3} hrefFor={hrefFor} />);
    expect(screen.getByRole("link", { name: "← Prev" })).toHaveAttribute("href", "/news?page=1");
    expect(screen.getByRole("link", { name: "Next →" })).toHaveAttribute("href", "/news?page=3");
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  });
});
