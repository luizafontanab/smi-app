// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge, Card, SectionTitle, Stat } from "@/components/console/ui";

describe("console/ui", () => {
  it("Card renders its id and children inside a section", () => {
    const { container } = render(<Card id="overview">Body</Card>);
    expect(container.querySelector("section#overview")).toHaveTextContent("Body");
  });

  it("SectionTitle renders its children as a heading", () => {
    render(<SectionTitle>Overview</SectionTitle>);
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("Stat shows the label, value, and an optional sub line", () => {
    const { rerender } = render(<Stat label="Members" value="128" />);
    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    rerender(<Stat label="Members" value="128" sub="+4 this month" />);
    expect(screen.getByText("+4 this month")).toBeInTheDocument();
  });

  it("Badge applies the tone-specific class", () => {
    const { rerender } = render(<Badge tone="green">Live</Badge>);
    expect(screen.getByText("Live")).toHaveClass("text-success");
    rerender(<Badge tone="red">Ended</Badge>);
    expect(screen.getByText("Ended")).toHaveClass("text-danger");
  });
});
