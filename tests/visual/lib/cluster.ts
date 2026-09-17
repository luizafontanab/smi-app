/**
 * Turning a scatter of changed pixels into a short list of rectangles.
 *
 * This is the report mechanism, not noise suppression: "1.4% of pixels differ"
 * is useless, "these four boxes differ" is a thing you can go and look at. The
 * only pixels it drops are ones too few and too scattered to point at.
 *
 * Two stages, because a full connected-component pass over a 1280x5000 mask is
 * 6.4M cells:
 *   A. reduce to 8x8 tiles — 100k cells, and single stray pixels vanish
 *   B. connected components over hot tiles, with a reach of 2 tiles so a line of
 *      text broken by spaces comes back as one box rather than one box per word
 */

export type Box = { x: number; y: number; w: number; h: number; changedPixels: number };

export const TILE = 8;
/** A tile is "hot" if at least this many of its 64 pixels changed. */
const MIN_PIXELS_PER_TILE = 3;
/** Tiles this far apart (in tile units) still join. 2 bridges a one-tile gap. */
const REACH = 2;
/** Regions smaller than this in either dimension are not worth pointing at. */
const MIN_BOX_PX = 12;
/** Nor are regions with fewer changed pixels than this. */
const MIN_BOX_PIXELS = 24;
/** Past this, the page has changed wholesale and a list stops being a list. */
export const MAX_REGIONS = 200;

/**
 * @param mask one byte per pixel, non-zero where the two images differ
 */
export function clusterMask(mask: Uint8Array, width: number, height: number): Box[] {
  const tw = Math.ceil(width / TILE);
  const th = Math.ceil(height / TILE);

  // Stage A: tile reduction.
  const tileCount = new Int32Array(tw * th);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const ty = (y / TILE) | 0;
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) tileCount[ty * tw + ((x / TILE) | 0)]++;
    }
  }
  const hot = new Uint8Array(tw * th);
  for (let i = 0; i < tileCount.length; i++) hot[i] = tileCount[i] >= MIN_PIXELS_PER_TILE ? 1 : 0;

  // Stage B: connected components. Iterative — a page-wide change would blow
  // the stack with recursion.
  const seen = new Uint8Array(tw * th);
  const boxes: Box[] = [];
  const stack: number[] = [];

  for (let start = 0; start < hot.length; start++) {
    if (!hot[start] || seen[start]) continue;

    seen[start] = 1;
    stack.push(start);
    let minTx = tw;
    let maxTx = -1;
    let minTy = th;
    let maxTy = -1;
    let pixels = 0;

    while (stack.length) {
      const i = stack.pop()!;
      const tx = i % tw;
      const ty = (i / tw) | 0;
      pixels += tileCount[i];
      if (tx < minTx) minTx = tx;
      if (tx > maxTx) maxTx = tx;
      if (ty < minTy) minTy = ty;
      if (ty > maxTy) maxTy = ty;

      for (let dy = -REACH; dy <= REACH; dy++) {
        const ny = ty + dy;
        if (ny < 0 || ny >= th) continue;
        for (let dx = -REACH; dx <= REACH; dx++) {
          const nx = tx + dx;
          if (nx < 0 || nx >= tw) continue;
          const j = ny * tw + nx;
          if (hot[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }

    const x = minTx * TILE;
    const y = minTy * TILE;
    const w = Math.min((maxTx + 1) * TILE, width) - x;
    const h = Math.min((maxTy + 1) * TILE, height) - y;
    if (w >= MIN_BOX_PX && h >= MIN_BOX_PX && pixels >= MIN_BOX_PIXELS) {
      boxes.push({ x, y, w, h, changedPixels: pixels });
    }
  }

  // Biggest changes first — that is the order someone wants to read them in.
  boxes.sort((a, b) => b.changedPixels - a.changedPixels);
  return boxes.slice(0, MAX_REGIONS);
}
