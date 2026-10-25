/**
 * The promo's clock (`./promo.ts`): easing, camera, counters, when each word and toast arrives.
 * No imports, so Remotion's bundler takes it as it is.
 */

/**
 * The promo's own clock: 30 beats a second. Scenes, entrances, words and toasts count beats; a
 * render at 60 fps plays two frames a beat, so it moves the same, smoother.
 */
export const PROMO_FPS = 30;

/** Each scene eases in over this many frames. */
const ENTER_FRAMES = 9;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Ease out, cubic: fast then settling. */
export const easeOut = (p: number) => 1 - (1 - clamp(p, 0, 1)) ** 3;
/** Ease in and out, cubic. */
const easeInOut = (p: number) => {
  const x = clamp(p, 0, 1);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
};

/** Ease in and out, sine: the lens moves and the dip, slower at both ends than cubic is. */
const sineInOut = (p: number) => (1 - Math.cos(Math.PI * clamp(p, 0, 1))) / 2;

/** A dip's frames in (it goes out over the usual 6). */
const DIP_FRAMES = 10;

/** Ease out, exponential: almost all of it at once, then a long settle. A speed ramp. */
const rampOut = (p: number) => {
  const x = clamp(p, 0, 1);
  return x === 1 ? 1 : 1 - 2 ** (-10 * x);
};
/** Ease in, exponential: still, then all of it at the end. */
const rampIn = (p: number) => {
  const x = clamp(p, 0, 1);
  return x === 0 ? 0 : 2 ** (10 * x - 10);
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

/**
 * How a scene comes in. `dip`: up out of the background, slow, so two scenes meet through it (on
 * a dark look, a dip through black). `rise`: up from below. `pull-back`: the camera starts close and pulls
 * back to the whole frame. `wipe`: a circle grows from the middle over the scene before it, a
 * track matte. `flow`: a flow edit's cut. The scene before rushes in and blurs, and this one
 * lands out of the same rush. The motion carries over the cut.
 */
export const ENTRANCES = ["rise", "dip", "pull-back", "wipe", "flow"] as const;
export type Entrance = (typeof ENTRANCES)[number];

/** A flow cut's frames on each side, and how far and how blurred it rushes at the cut. */
const FLOW_FRAMES = 8;
const FLOW_SCALE = 0.6;
const FLOW_BLUR = 18;

/**
 * A scene's opacity, transform, clip and filter `frame` frames into its `frames`. It goes out
 * over the last 6 frames, or, when the next scene comes in by `flow`, rushes into the cut.
 */
export function entranceAt(
  kind: Entrance,
  frame: number,
  frames: number,
  next?: Entrance,
): { opacity: number; transform: string; clipPath: string; filter: string } {
  if (next === "flow" && frame >= frames - FLOW_FRAMES) {
    const p = rampIn((frame - (frames - FLOW_FRAMES) + 1) / FLOW_FRAMES);
    return {
      opacity: 1,
      transform: `scale(${(1 + FLOW_SCALE * p).toFixed(4)})`,
      clipPath: "none",
      filter: `blur(${(FLOW_BLUR * p).toFixed(2)}px)`,
    };
  }
  const out = next === "flow" ? 1 : clamp((frames - frame) / 6, 0, 1);
  if (kind === "flow") {
    const p = rampOut(frame / FLOW_FRAMES);
    return {
      opacity: out,
      transform: `scale(${(1 + FLOW_SCALE * (1 - p)).toFixed(4)})`,
      clipPath: "none",
      filter: p >= 0.999 ? "none" : `blur(${(FLOW_BLUR * (1 - p)).toFixed(2)}px)`,
    };
  }
  return { ...entrance(kind, frame, out), filter: "none" };
}

function entrance(
  kind: Exclude<Entrance, "flow">,
  frame: number,
  out: number,
): { opacity: number; transform: string; clipPath: string } {
  if (kind === "pull-back") {
    const p = easeOut(frame / 18);
    return {
      opacity: Math.min(clamp(frame / 4, 0, 1), out),
      transform: `scale(${(1.35 - 0.35 * p).toFixed(4)})`,
      clipPath: "none",
    };
  }
  if (kind === "dip") {
    return {
      opacity: Math.min(sineInOut(frame / DIP_FRAMES), out),
      transform: "none",
      clipPath: "none",
    };
  }
  if (kind === "wipe") {
    // 72% of the circle's reference covers the corners of any frame.
    const p = easeInOut(frame / 14);
    return {
      opacity: out,
      transform: "none",
      clipPath: `circle(${(p * 72).toFixed(2)}% at 50% 50%)`,
    };
  }
  const p = entered(frame);
  return {
    opacity: Math.min(p, out),
    transform: `translateY(${((1 - p) * 40).toFixed(2)}px)`,
    clipPath: "none",
  };
}

/**
 * Where word `i` of `n` sits in a scattered layout, as shares of the frame (its left edge and
 * middle): down the frame in order, across it by the golden ratio, so no two land on one spot and
 * the same script always lands the same way.
 */
export function scatterAt(i: number, n: number): { x: number; y: number } {
  const x = 0.07 + ((i * 0.618034) % 1) * 0.6;
  const y = n > 1 ? 0.14 + (i / (n - 1)) * 0.72 : 0.5;
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

/**
 * A lens move (designs/2026-10-25-film-standard.md): the plane in 3D for the whole shot.
 * `track` drifts across, `push` and `pull` go in and out, `orbit` turns the plane on its upright,
 * `roll` tilts it back and rolls it (a Dutch angle), `macro` holds the page 3x past the frame's
 * edges, `rack` pulls focus from soft to sharp, then tracks.
 */
export const LENS_MOVES = ["track", "push", "pull", "orbit", "roll", "macro", "rack"] as const;
export type LensMove = (typeof LENS_MOVES)[number];

/** Each move's start and end: degrees, scale, drift (a share of the window's width). */
const LENS = {
  track: { rx: [0, 0], ry: [0, 0], rz: [0, 0], scale: [1.15, 1.15], dx: [0.02, -0.02] },
  push: { rx: [0, 0], ry: [0, 0], rz: [0, 0], scale: [1, 1.2], dx: [0, 0] },
  pull: { rx: [0, 0], ry: [0, 0], rz: [0, 0], scale: [1.25, 1], dx: [0, 0] },
  orbit: { rx: [18, 18], ry: [-12, -4], rz: [0, 0], scale: [1.1, 1.1], dx: [0, 0] },
  roll: { rx: [28, 28], ry: [0, 0], rz: [-8, -5], scale: [1.6, 1.6], dx: [0.01, -0.01] },
  macro: { rx: [0, 0], ry: [0, 0], rz: [0, 0], scale: [3, 3.2], dx: [0, 0] },
  rack: { rx: [0, 0], ry: [0, 0], rz: [0, 0], scale: [1.15, 1.15], dx: [0.02, -0.02] },
} as const satisfies Record<LensMove, Record<string, readonly [number, number]>>;

/** A rack's blur at the cut, and the seconds it takes to come sharp. */
const RACK_BLUR = 8;
const RACK_S = 0.6;

/**
 * The lens at progress `p` of a shot `seconds` long: rotations in degrees, the scale, the drift
 * (a share of the window's width) and the blur in px of a 1080p frame.
 */
export function lensAt(
  move: LensMove,
  p: number,
  seconds: number,
): { rx: number; ry: number; rz: number; scale: number; dx: number; blur: number } {
  const k = sineInOut(p);
  const m = LENS[move];
  const at = ([a, b]: readonly [number, number]) => a + (b - a) * k;
  const blur = move === "rack" ? RACK_BLUR * (1 - sineInOut((p * seconds) / RACK_S)) : 0;
  return { rx: at(m.rx), ry: at(m.ry), rz: at(m.rz), scale: at(m.scale), dx: at(m.dx), blur };
}

/** Monospace caps type this many characters a second. */
export const TYPE_CPS = 20;

/** How much of `text` is typed `frame` beats in, and whether the block caret shows (it blinks once typed). */
export function typedAt(frame: number, text: string): { shown: string; caret: boolean } {
  const n = clamp(Math.floor(((frame - 4) * TYPE_CPS) / PROMO_FPS), 0, text.length);
  const done = n === text.length;
  return { shown: text.slice(0, n), caret: !done || Math.floor(frame / 16) % 2 === 0 };
}

/** A swap card's word each lasts this many beats. */
export const SWAP_BEATS = 18;

/** An end card's tagline holds this many seconds before the title. */
export const TAGLINE_S = 2;
