import { describe, expect, it } from "vitest";
import { buildCloud, CARD_H, CARD_W, estimateWidth, packCloud, type Box, type CloudItem } from "@/lib/cloud-layout";
import { seededRand } from "@/lib/shuffle";

/**
 * Boxes shaped like real measured member names: featured ones are League
 * Spartan at 28-44px, the rest Source Sans at 15-18px, so widths run roughly
 * 90-260px against heights of 20 or 48.
 */
function directory(count: number, featured = 4, seed = "boxes"): Box[] {
  const rand = seededRand(seed);
  return Array.from({ length: count }, (_, i) => {
    const isFeatured = i < featured;
    return isFeatured
      ? { w: 180 + Math.round(rand() * 150), h: 48, weight: 2 }
      : { w: 90 + Math.round(rand() * 120), h: 20, weight: 1 };
  });
}

const GAP = 10;
const overlaps = (a: { x: number; y: number }, ab: Box, b: { x: number; y: number }, bb: Box) =>
  a.x < b.x + bb.w && b.x < a.x + ab.w && a.y < b.y + bb.h && b.y < a.y + ab.h;

describe("packCloud", () => {
  it("is deterministic — the same seed and boxes give the same layout", () => {
    const boxes = directory(60);
    expect(packCloud(boxes, { width: 1024, seed: "2026-09-17||" })).toEqual(
      packCloud(boxes, { width: 1024, seed: "2026-09-17||" }),
    );
  });

  it("differs across seeds — a new day relays the cloud", () => {
    const boxes = directory(60);
    const a = packCloud(boxes, { width: 1024, seed: "2026-09-17||" });
    const b = packCloud(boxes, { width: 1024, seed: "2026-09-18||" });
    expect(a.placed).not.toEqual(b.placed);
  });

  it("never overlaps two names", () => {
    const boxes = directory(120);
    const { placed } = packCloud(boxes, { width: 1024, seed: "overlap", gap: GAP });
    // Brute force, both directions covered by the single pair check.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          overlaps(placed[i], boxes[i], placed[j], boxes[j]),
          `box ${i} overlaps box ${j}`,
        ).toBe(false);
      }
    }
  });

  it("keeps every name inside the container's width", () => {
    const width = 720;
    const boxes = directory(80);
    const { placed } = packCloud(boxes, { width, seed: "bounds", gap: GAP });
    placed.forEach((p, i) => {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + boxes[i].w).toBeLessThanOrEqual(width);
      expect(p.y).toBeGreaterThanOrEqual(0);
    });
  });

  it("reports a height that contains every name, and sits flush to the top", () => {
    const boxes = directory(80);
    const { placed, height } = packCloud(boxes, { width: 900, seed: "height", gap: GAP });
    const bottom = Math.max(...placed.map((p, i) => p.y + boxes[i].h));
    expect(height).toBeGreaterThanOrEqual(bottom);
    // No dead band above the cloud — the height estimate is trimmed away.
    expect(Math.min(...placed.map((p) => p.y))).toBeLessThan(GAP);
  });

  it("puts the heaviest name in the middle", () => {
    const width = 1000;
    // One featured name among many small ones: it is placed first, at the
    // spiral's origin, so it should land near the horizontal centre.
    const boxes = directory(100, 1);
    const { placed } = packCloud(boxes, { width, seed: "centre", gap: GAP });
    const centre = placed[0].x + boxes[0].w / 2;
    expect(Math.abs(centre - width / 2)).toBeLessThan(width * 0.25);
  });

  it("orders by weight, not by input position", () => {
    // A heavy box last in the array still gets placed first, so it wins the
    // middle over the light boxes that precede it.
    const width = 800;
    const boxes: Box[] = [
      ...Array.from({ length: 40 }, () => ({ w: 120, h: 20, weight: 1 })),
      { w: 200, h: 48, weight: 5 },
    ];
    const { placed } = packCloud(boxes, { width, seed: "order", gap: GAP });
    const heavy = placed[placed.length - 1];
    expect(Math.abs(heavy.x + 100 - width / 2)).toBeLessThan(width * 0.25);
  });

  it("handles the degenerate sizes a filtered directory produces", () => {
    expect(packCloud([], { width: 900, seed: "s" })).toEqual({ placed: [], height: 0 });
    const one = packCloud([{ w: 200, h: 48, weight: 2 }], { width: 900, seed: "s" });
    expect(one.placed).toHaveLength(1);
    expect(one.height).toBeGreaterThan(0);
    // A zero-width container (a display:none ancestor) must not hang or throw.
    expect(packCloud(directory(5), { width: 0, seed: "s" })).toEqual({ placed: [], height: 0 });
  });

  it("stacks a name too wide for the container instead of dropping or hanging it", () => {
    const boxes: Box[] = [{ w: 400, h: 20, weight: 1 }, { w: 120, h: 20, weight: 1 }];
    const { placed } = packCloud(boxes, { width: 300, seed: "narrow", gap: GAP });
    expect(placed).toHaveLength(2);
    placed.forEach((p) => expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true));
  });

  it("packs the whole directory fast enough to run on every resize", () => {
    const boxes = directory(500);
    const t0 = performance.now();
    packCloud(boxes, { width: 1280, seed: "perf", gap: GAP });
    // Generous: the budget is a debounced resize, not a frame. Catches an
    // accidental O(n^2) collision test, which is the regression that matters.
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("estimateWidth", () => {
  it("grows with both the name and the size", () => {
    expect(estimateWidth("Acme Fabrication", 2)).toBeGreaterThan(estimateWidth("Acme", 2));
    expect(estimateWidth("Acme", 4)).toBeGreaterThan(estimateWidth("Acme", 2));
  });

  it("separates wide characters from narrow ones", () => {
    // Without a per-character table, "WWWW" and "iiii" would reserve the same
    // slot and one of them would collide with its neighbour.
    expect(estimateWidth("WWWW", 2)).toBeGreaterThan(estimateWidth("iiii", 2) * 2);
  });

  it("is proportional to size, so the tiers stay in step", () => {
    expect(estimateWidth("Northern Tooling Ltd", 4)).toBeCloseTo(estimateWidth("Northern Tooling Ltd", 2) * 2, 6);
  });
});

describe("buildCloud", () => {
  const members = (count: number, featured = 4): CloudItem[] =>
    Array.from({ length: count }, (_, i) => ({
      slug: `member-${i}`,
      name: `${["Acme", "Northern", "Westgate", "Brown", "Hall"][i % 5]} ${["Fabrication", "Tooling", "Engineering", "Metalwork"][i % 4]} Ltd`,
      featured: i < featured,
    }));

  it("is deterministic per seed and bucket", () => {
    const items = members(80);
    expect(buildCloud(items, { seed: "2026-09-17||", bucket: "wide" })).toEqual(
      buildCloud(items, { seed: "2026-09-17||", bucket: "wide" }),
    );
    // The two buckets are packed independently, not scaled copies.
    const wide = buildCloud(items, { seed: "s", bucket: "wide" });
    const narrow = buildCloud(items, { seed: "s", bucket: "narrow" });
    expect(wide.placements.map((p) => p.s)).not.toEqual(narrow.placements.map((p) => p.s));
  });

  it("returns every member exactly once, in input order, with finite geometry", () => {
    const items = members(60);
    const { placements } = buildCloud(items, { seed: "s", bucket: "wide" });
    expect(placements.map((p) => p.slug)).toEqual(items.map((i) => i.slug));
    placements.forEach((p) => {
      [p.x, p.y, p.s, p.cardDx].forEach((n) => expect(Number.isFinite(n)).toBe(true));
    });
  });

  it("gives featured members the largest size and the middle of the cloud", () => {
    const items = members(100, 3);
    const { placements } = buildCloud(items, { seed: "s", bucket: "wide" });
    const featured = placements.slice(0, 3);
    const rest = placements.slice(3);
    featured.forEach((f) => rest.forEach((r) => expect(f.s).toBeGreaterThan(r.s)));

    // Placed first, at the spiral's origin, so they sit nearer the horizontal
    // middle than the average name does.
    const offset = (p: { x: number }) => Math.abs(p.x - 50);
    const avgFeatured = featured.reduce((s, p) => s + offset(p), 0) / featured.length;
    const avgRest = rest.reduce((s, p) => s + offset(p), 0) / rest.length;
    expect(avgFeatured).toBeLessThan(avgRest);
  });

  it("uses exactly two sizes — big for featured, small for everyone else", () => {
    // The brief is explicit about this. A word cloud would happily carry more
    // tiers, so it is worth pinning rather than leaving to the tier table.
    const { placements } = buildCloud(members(120, 4), { seed: "s", bucket: "wide" });
    expect(new Set(placements.map((p) => p.s)).size).toBe(2);
  });

  it("keeps the overlay card inside the container at both edges", () => {
    const { placements } = buildCloud(members(150), { seed: "edges", bucket: "wide" });
    placements.forEach((p) => {
      const left = p.x + p.cardDx;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + CARD_W).toBeLessThanOrEqual(100);
    });
  });

  it("flips the card below a name that has no room above it", () => {
    const { placements } = buildCloud(members(200), { seed: "flip", bucket: "wide" });
    placements.forEach((p) => expect(p.cardBelow).toBe(p.y < CARD_H + 1));
    // The topmost name must be one of them, or the flip is dead code.
    expect(placements.some((p) => p.cardBelow)).toBe(true);
  });

  it("limits drift to the largest names", () => {
    const { placements } = buildCloud(members(300), { seed: "drift", bucket: "wide" });
    const drifting = placements.filter((p) => p.drift);
    expect(drifting.length).toBeGreaterThan(0);
    // Well under the full set — 300 infinite composited animations is the cost
    // this cap exists to avoid.
    expect(drifting.length).toBeLessThan(placements.length / 2);
    const still = placements.filter((p) => !p.drift);
    still.forEach((s) => drifting.forEach((d) => expect(d.s).toBeGreaterThanOrEqual(s.s)));
  });

  it("never overlaps two names, in either bucket", () => {
    for (const bucket of ["wide", "narrow"] as const) {
      const items = members(120);
      const { placements } = buildCloud(items, { seed: "overlap", bucket });
      const rects = placements.map((p, i) => ({
        x: p.x,
        y: p.y,
        w: estimateWidth(items[i].name, p.s),
        h: p.s * 1.2,
      }));
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          expect(
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
            `${items[i].name} overlaps ${items[j].name} in the ${bucket} bucket`,
          ).toBe(false);
        }
      }
    }
  });

  it("packs a full directory cheaply enough for a per-request server render", () => {
    // /member is force-dynamic, so both buckets are packed on every request.
    // An earlier spiral stepped by constant arc length against a container-sized
    // occupancy cell and took ~1.8s for this; the budget below is ~25x the
    // current cost and exists to catch a return to that, not to police ms.
    const items = members(200);
    const t0 = performance.now();
    buildCloud(items, { seed: "perf", bucket: "wide" });
    buildCloud(items, { seed: "perf", bucket: "narrow" });
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("handles an empty and a single-member directory", () => {
    expect(buildCloud([], { seed: "s", bucket: "wide" })).toEqual({ placements: [], height: 0 });
    const one = buildCloud(members(1, 1), { seed: "s", bucket: "wide" });
    expect(one.placements).toHaveLength(1);
    expect(one.height).toBeGreaterThan(0);
  });
});
