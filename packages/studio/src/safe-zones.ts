/**
 * Adapted from heygen-com/hyperframes `skills/embedded-captions/scripts/safe-zones.cjs` @5c7f631
 * (Apache-2.0); changed: only its occupancy grid (the per-cell max of the matte's alpha over a
 * window's frames, a cell his at 30/255) and its rule that the big word behind him must still read;
 * we score the word's own box on that grid and move or shrink it until 70% of it is clear, where
 * theirs profiles bands for an author to pick from. No luma, palette or narration zones.
 * See packages/studio/NOTICE.
 *
 * Where the big word behind the speaker goes (designs/2026-10-06-video-editor.md, step 6). Pure:
 * `addMask` folds each matte frame into a grid, `placeWord` picks the spot.
 */

export const ZONE = {
  /** Cells across and down the source frame. */
  grid: 48,
  /** A cell is his once its mean alpha reaches this in any frame of the window. */
  thresh: 30 / 255,
  /** The share of the word's box that must stay uncovered. */
  clear: 0.7,
  /** Kept free at the frame's edges, as a share of its height. */
  margin: 0.04,
  /** Each smaller try is this much of the last, down to `minScale` of the asked size. */
  shrink: 0.8,
  minScale: 0.5,
  /** A bold face runs about 0.62 em a letter; its letters stand about 0.72 em tall. */
  charW: 0.62,
  glyphH: 0.72,
} as const;

/** Where he is over a window: `grid` x `grid` cells over the source frame, row-major, "1" = him. */
export interface Zone {
  grid: number;
  occ: string;
}

/** A running max of each cell's mean alpha (one per window). */
export const zoneAcc = (grid: number = ZONE.grid) => new Float32Array(grid * grid);

/** Fold one `size` x `size` 8-bit mask into the window's grid. */
export function addMask(acc: Float32Array, mask: Uint8Array, size: number): void {
  const g = Math.round(Math.sqrt(acc.length));
  const sums = new Float64Array(g * g);
  const counts = new Uint32Array(g * g);
  for (let y = 0; y < size; y++) {
    const row = Math.min(g - 1, Math.floor((y * g) / size)) * g;
    for (let x = 0; x < size; x++) {
      const c = row + Math.min(g - 1, Math.floor((x * g) / size));
      sums[c] = (sums[c] as number) + (mask[y * size + x] as number);
      counts[c] = (counts[c] as number) + 1;
    }
  }
  for (let c = 0; c < g * g; c++) {
    const mean = (sums[c] as number) / Math.max(1, counts[c] as number) / 255;
    if (mean > (acc[c] as number)) acc[c] = mean;
  }
}

export function zoneOf(acc: Float32Array): Zone {
  const grid = Math.round(Math.sqrt(acc.length));
  let occ = "";
  for (const v of acc) occ += v >= ZONE.thresh ? "1" : "0";
  return { grid, occ };
}

/** [x, y, w, h] in output pixels. */
export type Rect = [number, number, number, number];

/** Where a `src`-sized picture sits in a `box`-sized frame, centred, contained or covering it. */
export function fitRect(
  src: [number, number],
  box: [number, number],
  fit: "contain" | "cover",
): Rect {
  const k = (fit === "contain" ? Math.min : Math.max)(box[0] / src[0], box[1] / src[1]);
  const w = src[0] * k;
  const h = src[1] * k;
  return [(box[0] - w) / 2, (box[1] - h) / 2, w, h];
}

/** Where a 9:16 picture sits: its `window` of a `size` picture scaled to cover 1080 x 1920. */
export function verticalRect(picture: {
  size: [number, number];
  window: [number, number, number, number];
}): Rect {
  const [x, y, w, h] = picture.window;
  const k = Math.max(1080 / w, 1920 / h);
  return [
    (1080 - w * k) / 2 - x * k,
    (1920 - h * k) / 2 - y * k,
    picture.size[0] * k,
    picture.size[1] * k,
  ];
}

/** Is output point (x, y) on him? `rect`: where the matted picture sits. */
function on(zone: Zone, rect: Rect, x: number, y: number): boolean {
  const u = (x - rect[0]) / rect[2];
  const v = (y - rect[1]) / rect[3];
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  const g = zone.grid;
  return zone.occ[Math.floor(v * g) * g + Math.floor(u * g)] === "1";
}

/** The share of `box` he covers, sampled on a 32 x 8 lattice. */
export function covered(zone: Zone, rect: Rect, box: Rect): number {
  const [bx, by, bw, bh] = box;
  let n = 0;
  let hit = 0;
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 32; i++) {
      n++;
      if (on(zone, rect, bx + ((i + 0.5) / 32) * bw, by + ((j + 0.5) / 8) * bh)) hit++;
    }
  return hit / n;
}

/** The word's letters at `size` px, centred on (x, y). */
export function wordBox(text: string, size: number, x: number, y: number): Rect {
  const w = ZONE.charW * size * Math.max(1, text.length);
  const h = ZONE.glyphH * size;
  return [x - w / 2, y - h / 2, w, h];
}

/** His left and right edge across rows `y0` to `y1`, in output px; null when he isn't there. */
function span(zone: Zone, rect: Rect, frameW: number, y0: number, y1: number) {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const step = frameW / 192;
  for (let x = step / 2; x < frameW; x += step)
    for (let y = y0; y <= y1; y += (y1 - y0) / 6 || 1)
      if (on(zone, rect, x, y)) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
        break;
      }
  return lo <= hi ? { lo, hi } : null;
}

export type Where = "middle" | "above" | "left" | "right";
export interface Spot {
  /** The word's middle, in output px. */
  x: number;
  y: number;
  size: number;
  where: Where;
  /** The share of its box left uncovered. */
  clear: number;
}

/**
 * Where the big word reads: at `clear` or more of its box uncovered by him and inside the frame.
 * At each size, from `size` down to `minScale` of it: the usual spot (`y`, centred), then above
 * his head (centred on him, the nearest height that reads), then beside him on the wider side, then
 * the other. Null: nothing reads, so the pick is skipped.
 */
export function placeWord(
  zone: Zone,
  rect: Rect,
  o: { frame: [number, number]; text: string; size: number; y: number },
): Spot | null {
  const [W, H] = o.frame;
  const m = ZONE.margin * H;
  const inside = (b: Rect) =>
    b[0] >= m && b[1] >= m && b[0] + b[2] <= W - m && b[1] + b[3] <= H - m;
  const read = (size: number, x: number, y: number, where: Where): Spot | null => {
    const b = wordBox(o.text, size, x, y);
    if (!inside(b)) return null;
    const clear = 1 - covered(zone, rect, b);
    return clear >= ZONE.clear ? { x, y, size, where, clear: Math.round(clear * 100) / 100 } : null;
  };
  // A long word starts at 90% of the width.
  const fit = Math.min(o.size, (W * 0.9) / (ZONE.charW * Math.max(1, o.text.length)));
  for (let size = fit; size >= o.size * ZONE.minScale - 0.5; size *= ZONE.shrink) {
    const s = Math.round(size);
    const h = ZONE.glyphH * s;
    const middle = read(s, W / 2, o.y, "middle");
    if (middle) return middle;
    const him = span(zone, rect, W, m, o.y + h / 2);
    if (him) {
      // Above: centred on him, climbing from the usual height.
      const cx = Math.min(W - m, Math.max(m, (him.lo + him.hi) / 2));
      const half = (ZONE.charW * s * Math.max(1, o.text.length)) / 2;
      const x = Math.min(W - m - half, Math.max(m + half, cx));
      for (let y = o.y; y - h / 2 >= m; y -= H * 0.01) {
        const above = read(s, x, y, "above");
        if (above) return above;
      }
      // Beside: the middle of the gap on each side of him at the usual height, wider first.
      const row = span(zone, rect, W, o.y - h / 2, o.y + h / 2) ?? him;
      const sides: [Where, number, number][] = [
        ["left", m, row.lo],
        ["right", row.hi, W - m],
      ];
      sides.sort((a, b) => b[2] - b[1] - (a[2] - a[1]));
      for (const [where, a, b] of sides) {
        const spot = read(s, (a + b) / 2, o.y, where);
        if (spot) return spot;
      }
    }
  }
  return null;
}
