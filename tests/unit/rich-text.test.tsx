// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RichText } from "@/components/RichText";

describe("RichText", () => {
  it("renders nothing for empty or missing html", () => {
    const { container: a } = render(<RichText html={null} />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<RichText html="" />);
    expect(b).toBeEmptyDOMElement();
  });

  it("sanitises on every render, stripping scripts", () => {
    render(<RichText html="<script>alert(1)</script><p>Body copy.</p>" />);
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText("Body copy.")).toBeInTheDocument();
  });

  it("appends a caller className to the base story-body class", () => {
    const { container } = render(<RichText html="<p>Body copy.</p>" className="prose" />);
    expect(container.firstElementChild).toHaveClass("story-body", "prose");
  });
});
