// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ScrollToHash } from "@/components/ScrollToHash";

beforeEach(() => {
  // Not implemented in jsdom.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  window.location.hash = "";
});

describe("ScrollToHash", () => {
  it("scrolls the element named by the URL fragment into view on mount", () => {
    window.location.hash = "#all-news";
    render(
      <>
        <h2 id="all-news">All news</h2>
        <ScrollToHash />
      </>,
    );
    expect(document.getElementById("all-news")!.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a fragment", () => {
    render(
      <>
        <h2 id="all-news">All news</h2>
        <ScrollToHash />
      </>,
    );
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does nothing when the fragment names no element", () => {
    window.location.hash = "#missing";
    render(<ScrollToHash />);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("survives a malformed fragment", () => {
    window.location.hash = "#%E0%A4%A"; // invalid percent-encoding — decodeURIComponent throws
    expect(() => render(<ScrollToHash />)).not.toThrow();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
