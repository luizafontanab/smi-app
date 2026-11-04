import { describe, expect, it } from "vitest";
import { buildCloud, cloudSample, estimateWidth, TOUCH_CAP, type CloudItem } from "@/lib/cloud-layout";

/**
 * #33: phones and tablets draw a capped sample of the directory with their own
 * packings. The whole directory as a phone cloud ran to ~21,000px.
 */

const members = (count: number, featuredAt: number[] = []): CloudItem[] =>
  Array.from({ length: count }, (_, i) => ({
    slug: `member-${i}`,
    name: `${["Acme", "Northern", "Westgate", "Brown", "Hall"][i % 5]} ${["Fabrication", "Tooling", "Engineering", "Metalwork"][i % 4]} Ltd`,
    featured: featuredAt.includes(i),
  }));

describe("cloudSample", () => {
  it("returns everyone when the directory is under the cap", () => {
    expect(cloudSample(members(5), 50)).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps every featured member, wherever the shuffle put them, then fills in order", () => {
    const picked = cloudSample(members(100, [3, 97]), 6);
    expect(picked).toEqual([0, 1, 2, 3, 4, 97]);
  });

  it("never samples a paid featured member away, even past the cap", () => {
    const picked = cloudSample(members(10, [0, 1, 2, 3]), 2);
    expect(picked).toEqual([0, 1, 2, 3]);
  });

  it("caps phones tighter than tablets", () => {
    expect(TOUCH_CAP.narrow).toBeLessThan(TOUCH_CAP.touch);
    expect(cloudSample(members(500), TOUCH_CAP.narrow)).toHaveLength(TOUCH_CAP.narrow);
  });
});

describe("touch packing", () => {
  it("never overlaps two names", () => {
    const items = members(120, [0, 1, 2]);
    const { placements } = buildCloud(items, { seed: "overlap", bucket: "touch" });
    const rects = placements.map((p, i) => ({ x: p.x, y: p.y, w: estimateWidth(items[i].name, p.s), h: p.s * 1.2 }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${i} overlaps ${j}`).toBe(false);
      }
    }
  });

  it("sets names larger than the desktop packing, so a 736px tablet column clears the 13px font floor", () => {
    const items = members(40);
    const wide = buildCloud(items, { seed: "s", bucket: "wide" });
    const touch = buildCloud(items, { seed: "s", bucket: "touch" });
    // 1cqw at a 736px column is 7.36px.
    expect(Math.min(...touch.placements.map((p) => p.s)) * 7.36).toBeGreaterThanOrEqual(13);
    expect(Math.min(...touch.placements.map((p) => p.s))).toBeGreaterThan(Math.min(...wide.placements.map((p) => p.s)));
  });
});
