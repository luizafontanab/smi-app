// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoryBody } from "@/components/StoryBody";

describe("StoryBody", () => {
  it("renders a single segment with no break markers", () => {
    const { container } = render(<StoryBody segments={["<p>Hello world.</p>"]} breaks={[]} />);
    expect(container.querySelectorAll(".story-body")).toHaveLength(1);
    expect(screen.getByText("Hello world.")).toBeInTheDocument();
  });

  it("interleaves a break between segments but never after the last one", () => {
    render(
      <StoryBody
        segments={["<p>First.</p>", "<p>Second.</p>"]}
        breaks={[<div key="0" data-testid="break-0">AD</div>]}
      />,
    );
    expect(screen.getByText("First.")).toBeInTheDocument();
    expect(screen.getByText("Second.")).toBeInTheDocument();
    expect(screen.getByTestId("break-0")).toBeInTheDocument();
  });

  it("puts the given className only on the first segment", () => {
    const { container } = render(
      <StoryBody segments={["<p>First.</p>", "<p>Second.</p>"]} breaks={[null]} className="prose" />,
    );
    const wrappers = container.querySelectorAll(".story-body");
    expect(wrappers[0]).toHaveClass("prose");
    expect(wrappers[1]).not.toHaveClass("prose");
  });

  it("strips disallowed markup from each segment via sanitizeRichText", () => {
    const { container } = render(<StoryBody segments={['<script>alert(1)</script><p>Safe.</p>']} breaks={[]} />);
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText("Safe.")).toBeInTheDocument();
  });
});
