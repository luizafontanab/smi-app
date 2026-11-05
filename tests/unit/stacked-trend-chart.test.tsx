// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { barFloorPx, StackedTrendChart } from "@/components/StackedTrendChart";

const bars = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-testid="stacked-bar"]')];

describe("StackedTrendChart", () => {
  // The 2px gaps used to be added on top of segments sized as `p% - 2px`, so a
  // tiny segment clamped to 0 — vanished — while its gap still made the bar
  // taller than its value. Now the bar is sized by the month's total and the
  // segments share it by value.
  it("sizes each bar by the month's total, with a floor that fits every segment", () => {
    const { container } = render(
      <StackedTrendChart labels={["2026-01", "2026-02"]} series={[{ label: "A", values: [1000, 500] }, { label: "B", values: [3, 0] }]} />,
    );
    const [jan, feb] = bars(container);
    expect(jan.style.height).toBe(`max(100%, ${barFloorPx(2)}px)`);
    expect(feb.style.height).toBe(`max(${(500 / 1003) * 100}%, ${barFloorPx(1)}px)`);
  });

  it("keeps a tiny non-zero segment visible and sized by its share", () => {
    const { container } = render(
      <StackedTrendChart labels={["2026-01", "2026-02"]} series={[{ label: "A", values: [1000, 1] }, { label: "B", values: [3, 1] }]} />,
    );
    const segments = [...bars(container)[0].children] as HTMLElement[];
    expect(segments).toHaveLength(2);
    expect(segments[1].style.flexGrow).toBe("3");
    expect(segments[1].style.minHeight).toBe("2px");
  });

  it("draws no bar for an empty month", () => {
    const { container } = render(
      <StackedTrendChart labels={["2026-01", "2026-02"]} series={[{ label: "A", values: [5, 0] }]} />,
    );
    expect(bars(container)).toHaveLength(1);
  });

  // Labels are the caller's; two equal ones must not collide as React keys.
  it("renders one slot per label even when labels repeat", () => {
    const { container } = render(
      <StackedTrendChart labels={["2026-03", "2026-03", "2026-04"]} series={[{ label: "A", values: [1, 2, 3] }]} />,
    );
    expect(bars(container)).toHaveLength(3);
  });
});
