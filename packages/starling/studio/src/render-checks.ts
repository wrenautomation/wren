/**
 * The quality floor's checks at render end (designs/2026-11-10-studio-quality-floor.md): flash
 * (WCAG 2.3.1), text contrast, a Short's pace. Each fault has a rank: P0 never ships, P1 ships
 * only with a reason, P2 shows beside Approve.
 */
import { spawn } from "node:child_process";
import { OVERLAY, type TextOverlay } from "./finish-look.js";
import type { BehindWord, ShortProps } from "./props.js";
import { type Box, bigWordBox, overlayBox } from "./text-box.js";

export type Rank = "P0" | "P1" | "P2" | "P3";
export interface Fault {
  rank: Rank;
  rule: string;
  /** Seconds into the rendered file. */
  at: number;
  says: string;
  /** Where on the frame, 0..1: left, top, width, height. */
  box?: Box;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const lin = (v: number | undefined) => LINEAR[v ?? 0] ?? 0;
/** WCAG relative luminance of the rgb24 pixel at byte `i`. */
const luminance = (px: Uint8Array, i: number) =>
  0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]);

/** ffmpeg's raw video out, in frames of `frameBytes` each, handed to `onFrame` as they come. */
async function rawFrames(
  ffmpeg: string,
  args: string[],
  frameBytes: number,
  onFrame: (px: Uint8Array) => void,
): Promise<void> {
  const p = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args, "-f", "rawvideo", "-"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  p.stderr.on("data", (d) => {
    err += d;
  });
  const closed = new Promise<number | null>((r) => p.on("close", r));
  let buf: Buffer = Buffer.alloc(0);
  for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= frameBytes) {
      onFrame(buf.subarray(0, frameBytes));
      buf = buf.subarray(frameBytes);
    }
  }
  const code = await closed;
  if (code !== 0) throw new Error(`ffmpeg: ${err.trim().slice(-300) || `exit ${code}`}`);
}

// --- flash -----------------------------------------------------------------------------------

/**
 * WCAG 2.3.1 general flash: an opposing change in relative luminance of `change` or more, the
 * darker side under `darkBelow`; more than `maxPerS` flashes (pairs) in any 1 s fails. Read per
 * tile of a `grid` x `grid` split, each under WCAG's 25% area, so a flash in a corner counts.
 */
export const FLASH = { grid: 4, side: 64, change: 0.1, darkBelow: 0.8, maxPerS: 3 } as const;

/** Each tile's mean luminance in one rgb24 frame `side` px square. */
function tileMeans(px: Uint8Array): number[] {
  const { side, grid } = FLASH;
  const t = side / grid;
  const sums: number[] = new Array(grid * grid).fill(0);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const k = Math.floor(y / t) * grid + Math.floor(x / t);
      sums[k] = (sums[k] ?? 0) + luminance(px, (y * side + x) * 3);
    }
  return sums.map((s) => s / (t * t));
}

/** The frames where one tile's luminance makes an opposing change (`FLASH`). */
export function opposingChanges(series: readonly number[]): number[] {
  const { change, darkBelow } = FLASH;
  const out: number[] = [];
  let dir = 0;
  let lo = series[0] ?? 0;
  let hi = lo;
  let peak = lo;
  const turn = (i: number, d: number, v: number) => {
    out.push(i);
    dir = d;
    peak = v;
  };
  series.forEach((v, i) => {
    if (dir === 0) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (v - lo >= change && lo < darkBelow) turn(i, 1, v);
      else if (hi - v >= change && v < darkBelow) turn(i, -1, v);
    } else if (dir > 0) {
      if (v > peak) peak = v;
      else if (peak - v >= change && v < darkBelow) turn(i, -1, v);
    } else if (v < peak) peak = v;
    else if (v - peak >= change && peak < darkBelow) turn(i, 1, v);
  });
  return out;
}

/** Each stretch with more than `maxPerS` flashes in 1 s, in any tile: one P0 each. */
export function flashFaults(tiles: readonly (readonly number[])[], fps: number): Fault[] {
  const limit = FLASH.maxPerS * 2;
  const hits: { at: number; tile: number; n: number }[] = [];
  tiles.forEach((series, tile) => {
    const ch = opposingChanges(series);
    for (let a = 0, b = 0; b < ch.length; b++) {
      while ((ch[b] as number) - (ch[a] as number) >= fps) a++;
      if (b - a + 1 > limit) hits.push({ at: (ch[a] as number) / fps, tile, n: b - a + 1 });
    }
  });
  hits.sort((x, y) => x.at - y.at);
  const stretches: { from: number; to: number; n: number; tiles: Set<number> }[] = [];
  for (const h of hits) {
    const last = stretches.at(-1);
    if (last && h.at - last.to <= 1) {
      last.to = h.at;
      last.n = Math.max(last.n, h.n);
      last.tiles.add(h.tile);
    } else stretches.push({ from: h.at, to: h.at, n: h.n, tiles: new Set([h.tile]) });
  }
  const g = FLASH.grid;
  return stretches.map((s) => {
    const cols = [...s.tiles].map((t) => t % g);
    const rows = [...s.tiles].map((t) => Math.floor(t / g));
    const [c0, c1, r0, r1] = [
      Math.min(...cols),
      Math.max(...cols),
      Math.min(...rows),
      Math.max(...rows),
    ];
    return {
      rank: "P0",
      rule: "flash",
      at: round1(s.from),
      says: `${Math.floor(s.n / 2)} flashes in 1 s from ${round1(s.from)} to ${round1(s.to + 1)} s; WCAG 2.3.1 allows 3`,
      box: [c0 / g, r0 / g, (c1 - c0 + 1) / g, (r1 - r0 + 1) / g],
    };
  });
}

/** Each tile's luminance per frame of `file`, at `fps`. */
export async function tileSeries(file: string, fps: number, ffmpeg: string): Promise<number[][]> {
  const { side, grid } = FLASH;
  const tiles: number[][] = Array.from({ length: grid * grid }, () => []);
  await rawFrames(
    ffmpeg,
    ["-i", file, "-an", "-vf", `fps=${fps},scale=${side}:${side}:flags=area,format=rgb24`],
    side * side * 3,
    (px) => {
      for (const [i, v] of tileMeans(px).entries()) tiles[i]?.push(v);
    },
  );
  return tiles;
}

// --- contrast --------------------------------------------------------------------------------

/**
 * Overlays and the big word (captions carry their own stroke or pill) against the pixels in a ring
 * around their text box: `pad` x font size out from the box, `ring` x font size wide, read at its
 * `percentile` brightest. Under `min`:1 at the worst of 3 frames is a P1.
 */
const CONTRAST = { min: 3, pad: 0.1, ring: 0.3, percentile: 0.8 } as const;
/** Both texts are filled white (`compositions/index.tsx`, Overlays and Behind). */
const FILL_LUMINANCE = 1;

export const contrastRatio = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Text drawn on one output, its box in frame px, its font size, and 3 times at full opacity. */
export interface TextOnScreen {
  text: string;
  box: Box;
  size: number;
  times: number[];
}

export function textOnScreen(
  p: { overlays: readonly TextOverlay[]; behind: readonly BehindWord[] },
  frame: readonly [number, number],
): TextOnScreen[] {
  const [w, h] = frame;
  const three = (a: number, b: number) => (b - a < 0.1 ? [(a + b) / 2] : [a, (a + b) / 2, b]);
  return [
    ...p.overlays.map((o) => {
      const fade = Math.min(OVERLAY.fadeS, (o.to - o.from) / 3);
      return {
        text: o.text,
        box: overlayBox(o, w, h),
        size: Math.round(OVERLAY.scale[o.size] * Math.min(w, h)),
        times: three(o.from + fade, o.to - fade),
      };
    }),
    // `bigWordState`: 0.25 s in, 0.3 s out.
    ...p.behind.map((b) => ({
      text: b.place.text,
      box: bigWordBox(b.place),
      size: b.place.size,
      times: three(b.s + 0.25, Math.max(b.s + 0.25, b.to - 0.3)),
    })),
  ];
}

const grow = ([x, y, w, h]: Box, by: number): Box => [x - by, y - by, w + 2 * by, h + 2 * by];
const inside = ([bx, by, bw, bh]: Box, x: number, y: number) =>
  x >= bx && x < bx + bw && y >= by && y < by + bh;

/** The ring's luminance at `percentile`, from `px` (rgb24) of the frame area `crop`; null when the ring is off frame. */
function ringLuminance(px: Uint8Array, crop: Box, t: Pick<TextOnScreen, "box" | "size">) {
  const inner = grow(t.box, CONTRAST.pad * t.size);
  const outer = grow(inner, CONTRAST.ring * t.size);
  const [cx, cy, cw, ch] = crop;
  const ring: number[] = [];
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const [fx, fy] = [cx + x + 0.5, cy + y + 0.5];
      if (inside(outer, fx, fy) && !inside(inner, fx, fy))
        ring.push(luminance(px, (y * cw + x) * 3));
    }
  if (!ring.length) return null;
  ring.sort((a, b) => a - b);
  return ring[Math.min(ring.length - 1, Math.floor(ring.length * CONTRAST.percentile))] as number;
}

/** The ring's frame area, cut to the frame, in whole px. */
function ringCrop(t: TextOnScreen, [w, h]: readonly [number, number]): Box {
  const [x, y, bw, bh] = grow(t.box, (CONTRAST.pad + CONTRAST.ring) * t.size);
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(w, Math.ceil(x + bw));
  const y1 = Math.min(h, Math.ceil(y + bh));
  return [x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
}

export async function contrastFaults(
  file: string,
  texts: readonly TextOnScreen[],
  frame: readonly [number, number],
  ffmpeg: string,
): Promise<Fault[]> {
  const faults: Fault[] = [];
  for (const t of texts) {
    const crop = ringCrop(t, frame);
    if (crop[2] < 2 || crop[3] < 2) continue;
    const reads = await Promise.all(
      t.times.map(async (at) => {
        let lum: number | null = null;
        await rawFrames(
          ffmpeg,
          [
            ...["-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-an"],
            ...["-vf", `format=rgb24,crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`],
          ],
          crop[2] * crop[3] * 3,
          (px) => {
            lum = ringLuminance(px, crop, t);
          },
        );
        return { at, lum: lum as number | null };
      }),
    );
    const worst = reads
      .flatMap((r) =>
        r.lum === null ? [] : [{ at: r.at, ratio: contrastRatio(FILL_LUMINANCE, r.lum) }],
      )
      .sort((a, b) => a.ratio - b.ratio)[0];
    if (!worst || worst.ratio >= CONTRAST.min) continue;
    const [w, h] = frame;
    const [x, y, bw, bh] = t.box;
    faults.push({
      rank: "P1",
      rule: "contrast",
      at: round1(worst.at),
      says: `"${t.text}" is ${worst.ratio.toFixed(1)}:1 against what is behind it; ${CONTRAST.min}:1 needed`,
      box: [x / w, y / h, bw / w, bh / h],
    });
  }
  return faults;
}

// --- pace ------------------------------------------------------------------------------------

/** A Short with no picture change for more than `blockS` is a P1; more than `warnS`, a P2. */
const PACE = { blockS: 10, warnS: 3 } as const;

/**
 * When a Short's picture changes (s): a cut between its kept spans, a layout mark, an overlay or
 * big word in or out, the title card going. Its crop is one fixed point, so it never counts.
 */
export function pictureChanges(p: ShortProps): number[] {
  const end = p.durationInFrames / p.fps;
  const cuts: number[] = [];
  let frames = 0;
  for (const s of p.segments.slice(0, -1)) {
    frames += s.frames;
    cuts.push(frames / p.fps);
  }
  const all = [
    ...cuts,
    ...p.layout.flatMap((l) => [l.from, l.to]),
    ...p.overlays.flatMap((o) => [o.from, o.to]),
    ...p.behind.flatMap((b) => [b.s, b.to]),
    ...(p.card ? [p.card.holdS + p.card.fadeS] : []),
  ];
  return [...new Set(all.filter((t) => t > 0 && t < end).map((t) => round1(t)))].sort(
    (a, b) => a - b,
  );
}

export function paceFaults(p: ShortProps): Fault[] {
  const end = p.durationInFrames / p.fps;
  const points = [0, ...pictureChanges(p), end];
  return points.slice(1).flatMap((t, i): Fault[] => {
    const from = points[i] as number;
    const still = t - from;
    if (still <= PACE.warnS) return [];
    const block = still > PACE.blockS;
    return [
      {
        rank: block ? "P1" : "P2",
        rule: "pace",
        at: round1(from),
        says: `no picture change for ${round1(still)} s (from ${round1(from)} to ${round1(t)} s); a Short changes at least every ${block ? PACE.blockS : PACE.warnS} s`,
      },
    ];
  });
}

/** Every floor check on one rendered output. `short`: its props when it is a Short (pace). */
export async function floorChecks(
  file: string,
  o: {
    props: { overlays: readonly TextOverlay[]; behind: readonly BehindWord[]; fps: number };
    frame: readonly [number, number];
    short: ShortProps | null;
    ffmpeg: string;
  },
): Promise<Fault[]> {
  const [tiles, contrast] = await Promise.all([
    tileSeries(file, o.props.fps, o.ffmpeg),
    contrastFaults(file, textOnScreen(o.props, o.frame), o.frame, o.ffmpeg),
  ]);
  return [...flashFaults(tiles, o.props.fps), ...contrast, ...(o.short ? paceFaults(o.short) : [])];
}
