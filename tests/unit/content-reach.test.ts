import { describe, expect, it } from "vitest";
import { contentReach, sumSeries } from "@/lib/content-reach";

describe("content reach (GAPS A9.2)", () => {
  it("sums aligned monthly series, treating a short series as zero", () => {
    expect(sumSeries([{ values: [1, 2, 3] }, { values: [10, 20, 30] }, { values: [100] }])).toEqual([111, 22, 33]);
    expect(sumSeries([])).toEqual([]);
  });

  it("totals every part, keeping the breakdown in order", () => {
    const r = contentReach([
      { label: "Adverts", total: 1200 },
      { label: "Stories", total: 340 },
      { label: "Videos", total: 0 },
    ]);
    expect(r.total).toBe(1540);
    expect(r.parts.map((p) => p.label)).toEqual(["Adverts", "Stories", "Videos"]);
  });
});
