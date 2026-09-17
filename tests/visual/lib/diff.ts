/**
 * Comparing one capture against its baseline, and saying what changed and where.
 *
 * Any differing pixel counts. There is no colour-distance threshold, no
 * anti-aliasing tolerance and no per-route allowance — by deliberate choice, the
 * suite reports everything and a person decides what matters. The only judgement
 * this file makes is how to GROUP changed pixels for reading (see cluster.ts).
 */
import sharp from "sharp";
import { clusterMask, MAX_REGIONS, type Box } from "./cluster";
import type { ElementBox } from "./elements";

export type Region = {
  n: number;
  box: [number, number, number, number];
  changedPixels: number;
  /** Element under the box, e.g. `main → h2 'Scheduled'`. */
  name: string;
  selector: string;
  /** Set when the baseline's element map named this area differently. */
  wasNamed?: string;
};

export type DiffResult = {
  changedPixels: number;
  changedPct: number;
  regions: Region[];
  /** Non-null when the two images are different sizes. */
  sizeNote: string | null;
  capped: boolean;
  diffPng: Buffer;
};

type Raw = { data: Buffer; width: number; height: number };

async function decode(png: Buffer): Promise<Raw> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Which element a changed region sits on.
 *
 * Prefers the smallest element that contains most of the box (so a changed word
 * is attributed to its heading, not to <main>), and breaks ties toward the
 * deepest node. Falls back to "within X" when nothing contains the box — which
 * is what a region spanning several siblings should say.
 */
function nameRegion(box: Box, elements: ElementBox[]): { name: string; selector: string } {
  const boxArea = box.w * box.h;
  let best: { score: number; el: ElementBox } | null = null;
  let smallestContainer: ElementBox | null = null;

  for (const el of elements) {
    const ix = Math.max(0, Math.min(box.x + box.w, el.x + el.w) - Math.max(box.x, el.x));
    const iy = Math.max(0, Math.min(box.y + box.h, el.y + el.h) - Math.max(box.y, el.y));
    if (ix <= 0 || iy <= 0) continue;

    const overlap = ix * iy;
    const elArea = Math.max(1, el.w * el.h);

    if (overlap >= boxArea * 0.99) {
      if (!smallestContainer || elArea < smallestContainer.w * smallestContainer.h) smallestContainer = el;
    }
    // Half the changed region inside it, or it is not what changed.
    if (overlap < boxArea * 0.5) continue;

    const score = (overlap / elArea) * (1 + el.depth * 0.01);
    if (!best || score > best.score) best = { score, el };
  }

  if (best) {
    // A box that fills most of the element means that element changed. A box
    // that is a small part of a big element means something INSIDE it changed —
    // saying "main" there would imply the whole page region moved.
    const fills = boxArea / Math.max(1, best.el.w * best.el.h);
    return fills >= 0.5
      ? { name: best.el.name, selector: best.el.selector }
      : { name: `within ${best.el.name}`, selector: best.el.selector };
  }
  if (smallestContainer) return { name: `within ${smallestContainer.name}`, selector: smallestContainer.selector };
  return { name: "(unmapped)", selector: "" };
}

/** The name the BASELINE had for the same area, when it differs — a semantic change. */
function previousName(box: Box, baselineElements: ElementBox[], currentName: string): string | undefined {
  if (baselineElements.length === 0) return undefined;
  const was = nameRegion(box, baselineElements);
  return was.name !== currentName && was.name !== "(unmapped)" ? was.name : undefined;
}

export async function diff(
  baselinePng: Buffer,
  currentPng: Buffer,
  currentElements: ElementBox[],
  baselineElements: ElementBox[],
): Promise<DiffResult> {
  const [base, cur] = await Promise.all([decode(baselinePng), decode(currentPng)]);

  const width = Math.min(base.width, cur.width);
  const height = Math.min(base.height, cur.height);

  const sizeNote =
    base.width !== cur.width || base.height !== cur.height
      ? `size changed: ${base.width}x${base.height} → ${cur.width}x${cur.height}` +
        (base.height !== cur.height ? ` (${cur.height > base.height ? "+" : ""}${cur.height - base.height}px tall)` : "")
      : null;

  // Compared over the overlapping area; the non-overlapping tail is handled
  // below as its own region so a taller page is never silently truncated.
  const mask = new Uint8Array(width * height);
  let changedPixels = 0;
  // Bounds of every changed pixel, so a change too small or too scattered to
  // cluster can still be pointed at rather than reported as "changed, nowhere".
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bi = (y * base.width + x) * 4;
      const ci = (y * cur.width + x) * 4;
      if (
        base.data[bi] !== cur.data[ci] ||
        base.data[bi + 1] !== cur.data[ci + 1] ||
        base.data[bi + 2] !== cur.data[ci + 2] ||
        base.data[bi + 3] !== cur.data[ci + 3]
      ) {
        mask[y * width + x] = 1;
        changedPixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const boxes = clusterMask(mask, width, height);

  /**
   * Every changed pixel was filtered out as too small to be a region — a handful
   * of anti-aliasing pixels on a glyph edge, typically. It is still a change and
   * still gets reported; a report that says "changed" without saying where is
   * the one thing this must never do.
   */
  const scattered = boxes.length === 0 && changedPixels > 0;
  if (scattered) {
    boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, changedPixels });
  }

  // The band that exists in only one of the two images is a change by definition.
  if (cur.height > base.height) {
    const h = cur.height - base.height;
    boxes.unshift({ x: 0, y: base.height, w: cur.width, h, changedPixels: cur.width * h });
    changedPixels += cur.width * h;
  }

  const regions: Region[] = boxes.slice(0, MAX_REGIONS).map((box, i) => {
    const { name, selector } = nameRegion(box, currentElements);
    return {
      n: i + 1,
      box: [box.x, box.y, box.w, box.h],
      changedPixels: box.changedPixels,
      name: scattered ? `${box.changedPixels}px scattered across ${name}` : name,
      selector,
      wasNamed: previousName(box, baselineElements, name),
    };
  });

  const total = Math.max(1, cur.width * cur.height);
  return {
    changedPixels,
    changedPct: (changedPixels / total) * 100,
    regions,
    sizeNote,
    capped: boxes.length > MAX_REGIONS,
    diffPng: await renderDiff(cur, mask, width, height, regions),
  };
}

/**
 * The diff image: the current page faded back, changed pixels in magenta, and a
 * numbered outline per region matching the rows in the report table.
 */
async function renderDiff(
  cur: Raw,
  mask: Uint8Array,
  width: number,
  height: number,
  regions: Region[],
): Promise<Buffer> {
  const out = Buffer.alloc(cur.width * cur.height * 4);

  // Faded copy of what the page looks like now, so the changes have context.
  for (let i = 0; i < cur.width * cur.height; i++) {
    const s = i * 4;
    out[s] = 255 - (255 - cur.data[s]) * 0.2;
    out[s + 1] = 255 - (255 - cur.data[s + 1]) * 0.2;
    out[s + 2] = 255 - (255 - cur.data[s + 2]) * 0.2;
    out[s + 3] = 255;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const s = (y * cur.width + x) * 4;
      out[s] = 255;
      out[s + 1] = 0;
      out[s + 2] = 212;
      out[s + 3] = 255;
    }
  }

  const stroke = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= cur.width || y >= cur.height) return;
    const s = (y * cur.width + x) * 4;
    out[s] = 0;
    out[s + 1] = 128;
    out[s + 2] = 255;
    out[s + 3] = 255;
  };
  for (const r of regions) {
    const [x, y, w, h] = r.box;
    for (let i = -1; i <= w; i++) {
      stroke(x + i, y - 1);
      stroke(x + i, y + h);
    }
    for (let i = -1; i <= h; i++) {
      stroke(x - 1, y + i);
      stroke(x + w, y + i);
    }
  }

  return sharp(out, { raw: { width: cur.width, height: cur.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
