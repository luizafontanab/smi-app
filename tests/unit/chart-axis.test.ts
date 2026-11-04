import { describe, expect, it } from "vitest";
import { axisLabel, axisTicks } from "@/components/ChartAxis";

// #33 M11: the member Stats charts had no month labels at all; these decide
// what the new axis prints and which slots it labels at each width.
describe("axisLabel", () => {
  it("turns a month key into its short name and a day key into day + month", () => {
    expect(axisLabel("2026-03")).toBe("Mar");
    expect(axisLabel("2026-12")).toBe("Dec");
    expect(axisLabel("2026-10-01")).toBe("1 Oct");
  });

  it("leaves anything else as given", () => {
    expect(axisLabel("Q3")).toBe("Q3");
  });
});

describe("axisTicks", () => {
  it("labels every month of a year on wide screens and every other one on phones, ending on the newest", () => {
    const ticks = axisTicks(12);
    expect(ticks.every((t) => t !== "none")).toBe(true);
    expect(ticks.at(-1)).toBe("all");
    expect(ticks.filter((t) => t === "all")).toHaveLength(6);
  });

  it("thins a long daily series to evenly spaced labels, phones showing a subset of the wide ones", () => {
    const ticks = axisTicks(28);
    const wide = ticks.flatMap((t, i) => (t === "none" ? [] : [i]));
    const phone = ticks.flatMap((t, i) => (t === "all" ? [i] : []));
    expect(wide.length).toBeLessThanOrEqual(12);
    expect(phone.length).toBeLessThanOrEqual(6);
    const gaps = (xs: number[]) => new Set(xs.slice(1).map((x, i) => x - xs[i]));
    expect(gaps(wide).size).toBe(1);
    expect(gaps(phone).size).toBe(1);
    expect(ticks.at(-1)).toBe("all");
  });
});
