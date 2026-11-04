import { seededRand } from "./seeded-rand";

/**
 * Word-cloud packing for the member directory's `?view=cloud` (MemberCloud).
 *
 * Deliberately DOM-free: boxes measured in the browser go in, coordinates come
 * out. That keeps the geometry unit-testable in vitest's default `node`
 * environment — jsdom has no layout engine, so a packer that read the DOM
 * itself could only ever be tested through the browser.
 *
 * Placement is an Archimedean spiral per box against a coarse occupancy grid,
 * largest first. The grid is what keeps it affordable: a collision test costs
 * the cells the candidate covers, not the number of boxes already placed.
 *
 * Seeded, not random — same seed and same boxes give the same layout, so a
 * day's cloud holds still across reloads the way memberDirectory()'s seeded
 * shuffle does, and the tests can assert on exact output.
 */

export type Box = {
  w: number;
  h: number;
  /** Placement priority — heaviest first, so featured names claim the middle. */
  weight: number;
};

export type Placed = { x: number; y: number };

export type PackResult = {
  /** Top-left corners, in the same order as the input boxes. */
  placed: Placed[];
  /** Height the container needs; the result is already trimmed to it. */
  height: number;
};

/**
 * Occupancy resolution and spiral step, both as a fraction of the container
 * width. Relative, not absolute, because callers work in whatever units suit
 * them — the member cloud packs in a 100-unit (1 unit = 1cqw) space, where a
 * fixed 8-unit cell would be 8% of the container and pack nothing tightly.
 * Smaller cells pack tighter and cost more; these are the knee.
 */
/**
 * Occupancy cell size, as a fraction of the mean box height — NOT of the
 * container. A cell fixed to the container is the trap: narrow-bucket names run
 * to half the container's width, so a 1/200 cell makes a single collision test
 * scan well over a thousand cells. Scaling to the boxes keeps every test in the
 * low tens regardless of bucket, which is what makes packing linear.
 */
const CELL_RATIO = 1 / 3;
/** Floor, so a degenerate box can't drive the cell to zero. */
const CELL_MIN_RATIO = 1 / 400;
/**
 * Angular step along the spiral. The spiral is parameterised by t, with radius
 * growing linearly in t, so probes thin out as the radius grows — the whole
 * point. Stepping by constant *arc length* instead looks tidier but is what
 * makes packing quadratic: the probes needed for one turn grow with the
 * radius, so a cloud a few hundred names deep spends tens of thousands of
 * probes per name.
 */
const DT = 0.28;
/**
 * Give up on the spiral after this many probes for one box and stack it below
 * the cloud instead. Only reachable when a box is nearly as wide as the
 * container, but it makes termination a property of the code rather than a
 * hope.
 */
const MAX_PROBES = 20000;
/**
 * Shrink a rect by a hair before testing it, so two boxes that merely share an
 * edge are not counted as colliding. Absolute rather than relative because it
 * is meant to be negligible in any unit system.
 */
const EPS = 1e-6;

/**
 * Empty space is the point of a word cloud, so the first height guess assumes
 * boxes cover only ~55% of the area they are dealt. Undershooting is cheap —
 * the spiral simply runs past the estimate and the result is trimmed — so this
 * only has to be in the right neighbourhood.
 */
const FILL = 0.55;

export function packCloud(boxes: Box[], opts: { width: number; seed: string; gap?: number }): PackResult {
  const { width, seed } = opts;
  const gap = opts.gap ?? 10;
  if (boxes.length === 0 || width <= 0) return { placed: [], height: 0 };

  const rand = seededRand(seed);
  const meanH = boxes.reduce((s, b) => s + b.h, 0) / boxes.length + gap;
  const CELL = Math.max(meanH * CELL_RATIO, width * CELL_MIN_RATIO);
  // One turn of the spiral advances the radius by about one box height, so the
  // search sweeps a fresh band each revolution instead of re-probing one it has
  // already rejected.
  const RING = Math.max(meanH, CELL * 2) / (2 * Math.PI);

  // Heaviest first, area as the tie-break, original index last so the order is
  // total — two identical boxes must not swap places between runs.
  const order = boxes
    .map((b, i) => i)
    .sort((a, b) => boxes[b].weight - boxes[a].weight || boxes[b].w * boxes[b].h - boxes[a].w * boxes[a].h || a - b);

  const area = boxes.reduce((sum, b) => sum + (b.w + gap) * (b.h + gap), 0);
  // Relative floor for the same reason the cell is: a fixed one would dwarf a
  // 100-unit space and force a tall, empty cloud.
  const targetH = Math.max(width * 0.2, area / FILL / width);
  const cx = width / 2;
  const cy = targetH / 2;
  // Bias the spiral into an ellipse matching the container, or a wide viewport
  // gets a circular cloud with dead space either side.
  const aspect = Math.max(1, width / targetH);

  const cols = Math.max(1, Math.ceil(width / CELL));
  // Rows are unbounded downward, so the grid is a sparse Set of row*cols+col
  // rather than a preallocated array.
  const taken = new Set<number>();

  const free = (x0: number, y0: number, w: number, h: number): boolean => {
    const c0 = Math.floor(x0 / CELL);
    const c1 = Math.floor((x0 + w) / CELL);
    const r0 = Math.floor(y0 / CELL);
    const r1 = Math.floor((y0 + h) / CELL);
    for (let r = r0; r <= r1; r++) {
      const base = r * cols;
      for (let c = c0; c <= c1; c++) if (taken.has(base + c)) return false;
    }
    return true;
  };

  const occupy = (x0: number, y0: number, w: number, h: number): void => {
    const c0 = Math.floor(x0 / CELL);
    const c1 = Math.floor((x0 + w) / CELL);
    const r0 = Math.floor(y0 / CELL);
    const r1 = Math.floor((y0 + h) / CELL);
    for (let r = r0; r <= r1; r++) {
      const base = r * cols;
      for (let c = c0; c <= c1; c++) taken.add(base + c);
    }
  };

  const placed: Placed[] = new Array(boxes.length);
  let maxBottom = 0;
  let rank = 0;

  for (const i of order) {
    const { w, h } = boxes[i];
    const bw = w + gap;
    const bh = h + gap;

    // Wider than the container: nothing can be placed legally, so stack it.
    if (bw > width) {
      const y = maxBottom;
      placed[i] = { x: 0, y };
      occupy(0, y, Math.min(bw, width) - EPS, bh);
      maxBottom = Math.max(maxBottom, y + bh);
      continue;
    }

    // Each box starts its spiral near where it belongs rather than at the
    // centre. Spiralling from the middle every time is what makes a cloud
    // quadratic: once the middle is full, every later box has to walk all the
    // way out past everything already placed. The anchor spreads with sqrt of
    // placement rank — uniform by area, so the heaviest boxes still start dead
    // centre and later ones start further out, and each finds space in a few
    // dozen probes instead of thousands.
    const spread = Math.sqrt(rank / boxes.length);
    rank++;
    const anchorAngle = rand() * Math.PI * 2;
    const ax = cx + Math.cos(anchorAngle) * spread * (width / 2) * 0.95;
    const ay = cy + Math.sin(anchorAngle) * spread * (targetH / 2) * 0.95;

    // A seeded phase per box, so the cloud does not grow a visible seam along
    // one axis. The spiral itself always starts at the anchor (t = 0).
    const phase = rand() * Math.PI * 2;
    let t = 0;
    let done = false;

    for (let probe = 0; probe < MAX_PROBES; probe++) {
      const r = RING * t;
      const theta = t + phase;
      // Clamp the candidate into the container rather than rejecting it. The
      // container is bounded horizontally but not vertically, so a spiral that
      // rejected every out-of-bounds probe would spend most of its angles
      // failing and drive the cloud downward into a tall, sparse ribbon.
      // Clamping instead lets it fill the sides and keeps the blob compact.
      const x0 = Math.min(Math.max(ax + Math.cos(theta) * r * aspect - bw / 2, 0), width - bw);
      const y0 = ay + Math.sin(theta) * r - bh / 2;

      if (y0 >= 0 && free(x0, y0, bw - EPS, bh - EPS)) {
        occupy(x0, y0, bw - EPS, bh - EPS);
        // Report the box's own top-left; the gap is padding around it, not part of it.
        placed[i] = { x: x0 + gap / 2, y: y0 + gap / 2 };
        maxBottom = Math.max(maxBottom, y0 + bh);
        done = true;
        break;
      }

      t += DT;
    }

    if (!done) {
      const y = maxBottom;
      const x0 = Math.max(0, Math.min(width - bw, cx - bw / 2));
      occupy(x0, y, bw - EPS, bh - EPS);
      placed[i] = { x: x0 + gap / 2, y: y + gap / 2 };
      maxBottom = y + bh;
    }
  }

  // Trim the band the height estimate left above the topmost box, so the cloud
  // sits against the top of its container rather than floating.
  const minTop = placed.reduce((m, p) => Math.min(m, p.y), Infinity);
  const shift = Number.isFinite(minTop) ? minTop : 0;
  if (shift > 0) for (const p of placed) p.y -= shift;

  return { placed, height: Math.max(0, maxBottom - shift) };
}

/* ─────────────────────────── the member cloud itself ─────────────────────── */

/**
 * Everything below turns member rows into a laid-out cloud. It stays in this
 * module, and stays pure, so the whole geometry runs during the server render
 * and unit-tests without a browser.
 *
 * Coordinates are in **container-query units** (1 unit = 1cqw = 1% of the
 * cloud's own width), never pixels. That is what makes resizing free: the
 * browser rescales positions, font sizes and gaps in lockstep, and a uniform
 * scale cannot introduce an overlap, so there is no resize handler anywhere.
 */

/** The packing space is 100 units wide so that one unit is exactly one cqw. */
const SPACE = 100;
/** Overlay card footprint, same units. ~100x100px at a 1120px container. */
export const CARD_W = 9;
export const CARD_H = 9.5;
/** Only the largest names drift; 500 composited layers would not be free. */
const DRIFT_COUNT = 60;

export type CloudItem = { slug: string; name: string; featured: boolean };

export type CloudPlacement = {
  slug: string;
  /** Top-left of the name, in cqw. */
  x: number;
  y: number;
  /** Font size, in cqw. */
  s: number;
  /** Horizontal offset of the overlay card from the name's own origin, already
   *  clamped so the card cannot leave the container at either edge. */
  cardDx: number;
  /** Card hangs below the name instead of above — set near the top edge. */
  cardBelow: boolean;
  drift: boolean;
};

export type Cloud = { placements: CloudPlacement[]; height: number };

/**
 * Per-character advance widths in em, for a semibold humanist sans. Source Sans
 * 3's real metrics are not available on the server, so the server render packs
 * against this estimate and the browser corrects it once (see MemberCloud's
 * refine pass) — the correction is what the settle animation shows.
 */
const NARROW = new Set("iljtfIr.,:;'!|()[]{}/\\-");
const WIDE = new Set("mwMW@%");
const EM_SPACE = 0.26;
const EM_DIGIT = 0.5;
const EM_UPPER = 0.66;
const EM_DEFAULT = 0.51;
/**
 * Estimates run wide on purpose: a name given slightly too much room leaves a
 * gap, one given too little collides or runs past the container edge. Measured
 * against the real faces, 1.08 still left long digit-heavy names ~4% short, and
 * the server layout is what a no-JS visitor, axe and the visual baseline all
 * see — so the margin is set where nothing observed exceeds it.
 */
const SAFETY = 1.14;

export function estimateWidth(name: string, size: number): number {
  let em = 0;
  for (const ch of name) {
    if (ch === " ") em += EM_SPACE;
    else if (NARROW.has(ch)) em += 0.3;
    else if (WIDE.has(ch)) em += 0.88;
    else if (ch >= "0" && ch <= "9") em += EM_DIGIT;
    else if (ch >= "A" && ch <= "Z") em += EM_UPPER;
    else em += EM_DEFAULT;
  }
  return em * size * SAFETY;
}

/**
 * Type scale, in cqw. `wide` is the desktop packing; `narrow` is a separate,
 * looser packing for < 640px — not a scaled-down copy of the wide one, because
 * the CSS font-size floor stops the smallest names shrinking any further and a
 * uniform scale would then close the gaps it relies on. `touch` is a third
 * packing for tablets (640–1023px with a coarse pointer): the wide one at that
 * width hits the font floor and leaves rows ~20px apart, too tight to tap (#33).
 */
const TIERS = {
  /**
   * Two sizes only, as specified: featured big, everyone else small. The
   * `sizes`/`mix` pair is kept as a list so a future brief can reintroduce
   * intermediate tiers without touching the packer, but today it holds one
   * entry and every non-featured name is set at the same size.
   */
  wide: { featured: 2.6, sizes: [1.3], mix: [1], pad: 0.55, line: 1.5 },
  /**
   * `line` is doing touch-target work here, not typography. The site's `.tap`
   * utility reserves 44px, which a cloud of a hundred-plus names cannot spend
   * on each one — so the names are not `.tap`, and the narrow packing instead
   * reserves ~34px per name at phone widths, above WCAG 2.5.8's 24px AA size.
   * Names are text, so the horizontal dimension is comfortably clear either way.
   * 4.3cqw is ~15px on a 390px phone: only the capped subset is packed here
   * (see TOUCH_CAP), so the names can afford to be readable (#33).
   */
  narrow: { featured: 6, sizes: [4.3], mix: [1], pad: 0.9, line: 2.0 },
  /** ~14px names on ~30px rows at a 736px tablet column; ~18px at 1000px. */
  touch: { featured: 3.2, sizes: [1.9], mix: [1], pad: 0.7, line: 2.0 },
} as const;

export type Bucket = keyof typeof TIERS;

/**
 * How many names the touch packings (phone and tablet) draw. The whole
 * directory as a phone cloud was ~21,000px — 25 screens — so touch screens get
 * a sample and a link to the full list (#33). The sample rotates with the
 * daily seed like everything else, so no member is permanently left out.
 */
export const TOUCH_CAP: Record<Exclude<Bucket, "wide">, number> = { narrow: 50, touch: 120 };

/**
 * Which items a capped packing draws, as indices into `items`: every featured
 * member (paid placement is never sampled away), then the rest in the order
 * given — memberDirectory()'s daily shuffle — until the cap. Input order is
 * kept, so the result can be fed straight to buildCloud.
 */
export function cloudSample(items: CloudItem[], cap: number): number[] {
  const featured = items.flatMap((it, i) => (it.featured ? [i] : []));
  const room = Math.max(0, cap - featured.length);
  const rest = items.flatMap((it, i) => (it.featured ? [] : [i])).slice(0, room);
  return [...featured, ...rest].sort((a, b) => a - b);
}

/**
 * Lay out one bucket of the cloud. Featured members are packed first so they
 * take the middle; everything else follows in the order `memberDirectory()`
 * already shuffled it into, which is what keeps a member's position stable for
 * the day and rotating the next.
 */
export function buildCloud(
  items: CloudItem[],
  opts: {
    seed: string;
    bucket: Bucket;
    /**
     * Real rendered name widths in cqw, one per item, measured in the browser.
     * Omitted on the server, where only the estimate exists. Sizes are drawn
     * from the seeded stream, so both passes assign the same tier to the same
     * member and the measurements stay aligned to the items.
     */
    widths?: number[];
  },
): Cloud {
  const tier = TIERS[opts.bucket];
  if (items.length === 0) return { placements: [], height: 0 };

  // A distinct stream per bucket, so the two packings don't mirror each other.
  const rand = seededRand(`${opts.seed}|cloud|${opts.bucket}`);

  // Walk the cumulative mix rather than indexing fixed positions, so the tier
  // table can hold one size (today) or several without this going out of step.
  const sizes: readonly number[] = tier.sizes;
  const mix: readonly number[] = tier.mix;
  const pickSize = (roll: number): number => {
    let acc = 0;
    for (let k = 0; k < sizes.length; k++) {
      acc += mix[k] ?? 0;
      if (roll < acc) return sizes[k]!;
    }
    return sizes[sizes.length - 1]!;
  };

  const sized = items.map((item) => ({ item, s: item.featured ? tier.featured : pickSize(rand()) }));

  const pad = tier.pad;
  const boxes: Box[] = sized.map(({ item, s }, i) => ({
    w: (opts.widths?.[i] ?? estimateWidth(item.name, s)) + pad,
    h: s * tier.line + pad,
    // Featured outrank every size tier; size breaks ties below that.
    weight: item.featured ? 100 + s : s,
  }));

  const { placed, height } = packCloud(boxes, { width: SPACE, seed: opts.seed, gap: 0 });

  // The largest names drift; the rest hold still. Selected by rank, not by a
  // size threshold — with only two sizes in play a threshold would sweep in
  // every name that ties with the cutoff, which is all of them.
  const driftSet = new Set(
    sized
      .map((_, i) => i)
      .sort((a, b) => sized[b].s - sized[a].s || a - b)
      .slice(0, DRIFT_COUNT),
  );

  const placements = sized.map(({ item, s }, i) => {
    const x = placed[i].x + pad / 2;
    const y = placed[i].y + pad / 2;
    const w = boxes[i].w - pad;
    const centre = x + w / 2;
    // Clamp at pack time rather than measuring in the browser: the card can
    // never leave the container, and the rule is unit-testable.
    const cardLeft = Math.min(Math.max(centre - CARD_W / 2, 0.5), SPACE - CARD_W - 0.5);
    return {
      slug: item.slug,
      x,
      y,
      s,
      cardDx: cardLeft - x,
      cardBelow: y < CARD_H + 1,
      drift: driftSet.has(i),
    };
  });

  return { placements, height };
}
