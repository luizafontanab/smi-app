/**
 * The visual suite's comparison maths.
 *
 * The screenshots themselves are machine-local and never run in CI, but the
 * clustering and the box→element naming are pure functions of their inputs, so
 * they are testable here — and they are the part most likely to break quietly.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { clusterMask, TILE } from "../visual/lib/cluster";
import { diff } from "../visual/lib/diff";
import type { ElementBox } from "../visual/lib/elements";

/** A white canvas with optional filled black rectangles. */
async function png(
  width: number,
  height: number,
  rects: { x: number; y: number; w: number; h: number }[] = [],
): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4, 0xff);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * width + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

const el = (name: string, x: number, y: number, w: number, h: number, depth = 1): ElementBox => ({
  name,
  x,
  y,
  w,
  h,
  depth,
  selector: name,
});

describe("clusterMask", () => {
  it("finds nothing in an empty mask", () => {
    expect(clusterMask(new Uint8Array(100 * 100), 100, 100)).toEqual([]);
  });

  it("returns one box around a solid change", () => {
    const mask = new Uint8Array(100 * 100);
    for (let y = 20; y < 50; y++) for (let x = 30; x < 60; x++) mask[y * 100 + x] = 1;

    const boxes = clusterMask(mask, 100, 100);
    expect(boxes).toHaveLength(1);
    // Boxes are tile-aligned, so they round outward to the enclosing 8px grid.
    expect(boxes[0].x).toBeLessThanOrEqual(30);
    expect(boxes[0].y).toBeLessThanOrEqual(20);
    expect(boxes[0].x + boxes[0].w).toBeGreaterThanOrEqual(60);
    expect(boxes[0].y + boxes[0].h).toBeGreaterThanOrEqual(50);
  });

  it("separates two changes that are far apart", () => {
    const mask = new Uint8Array(300 * 300);
    for (let y = 10; y < 40; y++) for (let x = 10; x < 40; x++) mask[y * 300 + x] = 1;
    for (let y = 200; y < 230; y++) for (let x = 200; x < 230; x++) mask[y * 300 + x] = 1;

    expect(clusterMask(mask, 300, 300)).toHaveLength(2);
  });

  it("joins two changes separated by a single cold tile, as words in a line are", () => {
    const mask = new Uint8Array(300 * 100);
    for (let y = 10; y < 40; y++) {
      for (let x = 10; x < 40; x++) mask[y * 300 + x] = 1;
      for (let x = 40 + TILE; x < 80 + TILE; x++) mask[y * 300 + x] = 1;
    }
    expect(clusterMask(mask, 300, 100)).toHaveLength(1);
  });

  it("drops a change too small to point at", () => {
    const mask = new Uint8Array(100 * 100);
    for (let y = 50; y < 52; y++) for (let x = 50; x < 52; x++) mask[y * 100 + x] = 1;
    expect(clusterMask(mask, 100, 100)).toEqual([]);
  });
});

describe("diff", () => {
  it("reports nothing for an image compared with itself", async () => {
    const image = await png(200, 200, [{ x: 10, y: 10, w: 50, h: 50 }]);
    const result = await diff(image, image, [], []);

    expect(result.changedPixels).toBe(0);
    expect(result.regions).toEqual([]);
    expect(result.sizeNote).toBeNull();
  });

  it("counts every differing pixel — there is no tolerance by design", async () => {
    const before = await png(200, 200);
    const after = await png(200, 200, [{ x: 40, y: 40, w: 30, h: 30 }]);

    const result = await diff(before, after, [], []);
    expect(result.changedPixels).toBe(30 * 30);
  });

  it("names a changed region after the element sitting under it", async () => {
    const before = await png(400, 400);
    const after = await png(400, 400, [{ x: 100, y: 100, w: 60, h: 40 }]);

    const elements = [
      el("main", 0, 0, 400, 400, 0),
      el("main → h2 'Scheduled'", 95, 95, 70, 50, 3),
    ];

    const result = await diff(before, after, elements, []);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].name).toBe("main → h2 'Scheduled'");
  });

  it("says what a region used to be called when the baseline named it differently", async () => {
    const before = await png(400, 400);
    const after = await png(400, 400, [{ x: 100, y: 100, w: 60, h: 40 }]);

    const result = await diff(
      before,
      after,
      [el("main → h2 'Scheduled'", 95, 95, 70, 50, 3)],
      [el("main → h2 'Upcoming'", 95, 95, 70, 50, 3)],
    );

    expect(result.regions[0].wasNamed).toBe("main → h2 'Upcoming'");
  });

  it("falls back to 'within' when a change spans several siblings", async () => {
    const before = await png(400, 400);
    const after = await png(400, 400, [{ x: 50, y: 50, w: 300, h: 200 }]);

    // Two small children, neither of which contains half the changed area.
    const result = await diff(
      before,
      after,
      [el("main", 0, 0, 400, 400, 0), el("main → p", 60, 60, 20, 20, 4)],
      [],
    );

    expect(result.regions[0].name).toBe("within main");
  });

  it("reports a height change instead of silently comparing a truncated page", async () => {
    const before = await png(200, 200);
    const after = await png(200, 260);

    const result = await diff(before, after, [], []);
    expect(result.sizeNote).toContain("200x200 → 200x260");
    expect(result.sizeNote).toContain("+60px tall");
    // The band that exists in only one image is itself a change.
    expect(result.regions.length).toBeGreaterThan(0);
    expect(result.regions[0].box[1]).toBe(200);
  });
});

describe("sub-cluster changes", () => {
  it("still points at a change too small to cluster, rather than saying 'changed, 0 regions'", async () => {
    const before = await png(400, 400);
    // Four isolated pixels: far below the minimum cluster size.
    const after = await png(400, 400, [
      { x: 100, y: 100, w: 1, h: 1 },
      { x: 102, y: 100, w: 1, h: 1 },
      { x: 100, y: 102, w: 1, h: 1 },
      { x: 140, y: 130, w: 1, h: 1 },
    ]);

    const result = await diff(before, after, [el("main → p 'Total'", 90, 90, 80, 60, 3)], []);

    expect(result.changedPixels).toBe(4);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].name).toContain("4px scattered across");
    expect(result.regions[0].name).toContain("main → p 'Total'");
  });
});
