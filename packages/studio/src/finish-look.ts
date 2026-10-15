/**
 * How text on the video and caption heights look (finish.ts), with no value imports: the Remotion
 * entry and the Studio page both draw from these numbers, so the preview matches the render.
 */

export const OVERLAY_SIZES = ["s", "m", "l"] as const;
export type OverlaySize = (typeof OVERLAY_SIZES)[number];
/**
 * Text on the video: `from`/`to` seconds (raw on the edit, cut-timeline in props), `x`/`y` its
 * middle as 0..1 of the output frame (the same spot in every format), `size` a share of the
 * frame's short side.
 */
export interface TextOverlay {
  text: string;
  from: number;
  to: number;
  x: number;
  y: number;
  size: OverlaySize;
}

export const OVERLAY = {
  maxChars: 120,
  max: 30,
  /** Shortest time on screen. */
  minS: 0.3,
  /** Font size as a share of the frame's short side. */
  scale: { s: 0.045, m: 0.065, l: 0.095 } satisfies Record<OverlaySize, number>,
  /** Kept this far (0..1) from every edge. */
  margin: 0.04,
  /** Fade in and out. */
  fadeS: 0.18,
  /** Widest line, as a share of the frame's width. */
  maxWidth: 0.86,
} as const;

/**
 * Where a `size` picture sits (left, top, width, height, in the frame's pixels) so that `box` of
 * it (default the whole picture) covers a `w` x `h` frame. Without a `centre` the frame centres on
 * the box; with one (0..1 of the picture) it centres there, kept inside the picture. The render
 * and the Finish preview place a face the same way.
 */
export function coverRect(
  size: readonly [number, number],
  box: readonly [number, number, number, number] | null,
  w: number,
  h: number,
  centre?: { x: number; y: number } | null,
): [number, number, number, number] {
  const [fw, fh] = size;
  const [bx, by, bw, bh] = box ?? [0, 0, fw, fh];
  const k = Math.max(w / bw, h / bh);
  // The picture is at least as big as the frame, so these keep it covering the frame.
  const keep = (at: number, span: number, frame: number) => Math.min(0, Math.max(frame - span, at));
  const left = centre ? keep(w / 2 - centre.x * fw * k, fw * k, w) : (w - bw * k) / 2 - bx * k;
  const top = centre ? keep(h / 2 - centre.y * fh * k, fh * k, h) : (h - bh * k) / 2 - by * k;
  return [left, top, fw * k, fh * k];
}

/** Where a caption line's middle sits when the edit doesn't say, 0..1 from the top. */
export const CAPTION_Y = { long: 0.885, short: 0.66 } as const;

/**
 * One overlay at `t` in a `w` x `h` frame: null when off screen, else its middle in px, font size
 * in px, widest line in px, and opacity (a short fade at each end, so it never pops).
 */
export function overlayAt(
  o: TextOverlay,
  t: number,
  w: number,
  h: number,
): { x: number; y: number; size: number; width: number; opacity: number } | null {
  if (t < o.from || t >= o.to) return null;
  const fade = Math.min(OVERLAY.fadeS, (o.to - o.from) / 3);
  const k = Math.min(1, (t - o.from) / fade, (o.to - t) / fade);
  return {
    x: o.x * w,
    y: o.y * h,
    size: Math.round(OVERLAY.scale[o.size] * Math.min(w, h)),
    width: Math.round(OVERLAY.maxWidth * w),
    opacity: Math.max(0, Math.min(1, k * (2 - k))),
  };
}
