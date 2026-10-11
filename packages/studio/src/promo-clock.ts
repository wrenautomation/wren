/**
 * The promo's clock (`./promo.ts`): easing, camera, counters, when each word and toast arrives.
 * No imports, so Remotion's bundler takes it as it is.
 */

/** Each scene eases in over this many frames. */
export const ENTER_FRAMES = 9;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Ease out, cubic: fast then settling. */
export const easeOut = (p: number) => 1 - (1 - clamp(p, 0, 1)) ** 3;
/** Ease in and out, cubic. */
export const easeInOut = (p: number) => {
  const x = clamp(p, 0, 1);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
};

/** How far a scene has come in, 0 to 1, over its first `ENTER_FRAMES`. */
export const entered = (frame: number) => easeOut(frame / ENTER_FRAMES);

/** How many of `n` words show `frame` frames in: one every `per` frames, after the entrance. */
export const wordsIn = (frame: number, n: number, per = 4) =>
  clamp(Math.floor((frame - 2) / per) + 1, 0, n);

/** The camera at progress `p`: between the moves around it, eased; the whole image before any. */
export function cameraAt(
  moves: readonly { at: number; x: number; y: number; zoom: number }[],
  p: number,
): { x: number; y: number; zoom: number } {
  const all = [...moves].sort((a, b) => a.at - b.at);
  const start = { at: 0, x: 0.5, y: 0.5, zoom: 1 };
  const path = all[0] && all[0].at > 0 ? [start, ...all] : all.length ? all : [start];
  const last = path.at(-1) ?? start;
  if (p >= last.at) return { x: last.x, y: last.y, zoom: last.zoom };
  const i = path.findIndex((m) => m.at > p);
  const a = path[i - 1] ?? start;
  const b = path[i] ?? last;
  const k = easeInOut((p - a.at) / (b.at - a.at || 1));
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    zoom: a.zoom + (b.zoom - a.zoom) * k,
  };
}

/**
 * The image's transform for a camera: a scale and the shift that puts (x, y) in the middle,
 * clamped so no edge shows past the image. In px of a `w` by `h` frame the image covers.
 */
export function framing(cam: { x: number; y: number; zoom: number }, w: number, h: number) {
  const s = cam.zoom;
  const tx = clamp(w / 2 - cam.x * w * s, w - w * s, 0);
  const ty = clamp(h / 2 - cam.y * h * s, h - h * s, 0);
  return { scale: s, tx, ty };
}

/** A number counting up to `value` by progress `p`, as written: prefix, separators, suffix. */
export function countAt(
  item: { value: number; prefix: string; suffix: string; decimals: number },
  p: number,
): string {
  const v = item.value * easeOut(p);
  const n = v.toLocaleString("en-US", {
    minimumFractionDigits: item.decimals,
    maximumFractionDigits: item.decimals,
  });
  return `${item.prefix}${n}${item.suffix}`;
}

/** The frame toast `i` arrives on: one every 16 frames after the title. */
export const toastAt = (i: number, titled: boolean) => (titled ? 14 : 4) + i * 16;

/** The largest box of the image's shape (`size`, else the room's) inside `w` by `h`. */
export function fitBox(size: readonly [number, number] | undefined, w: number, h: number) {
  if (!size) return { w, h };
  const k = Math.min(w / size[0], h / size[1]);
  return { w: Math.round(size[0] * k), h: Math.round(size[1] * k) };
}
