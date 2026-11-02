/**
 * How text on the video, the corner camera and the captions look (finish.ts), with type imports
 * only: the Remotion entry and the Studio page both draw from these, so the preview matches the
 * render.
 */
import type { WordState } from "./caption-styles.js";

type Len = number | string;
/**
 * The CSS these looks set, typed so React's `style` takes it. No import of React's types here:
 * they stub the DOM's element types for every package that reaches this file.
 */
export interface CSSProperties {
  position?: "absolute" | "relative";
  display?: "flex" | "inline-block";
  flexDirection?: "column";
  justifyContent?: string;
  alignItems?: string;
  textAlign?: "center";
  overflow?: "hidden";
  inset?: Len;
  left?: Len;
  right?: Len;
  top?: Len;
  bottom?: Len;
  width?: Len;
  height?: Len;
  maxWidth?: Len;
  padding?: Len;
  paddingBottom?: Len;
  borderRadius?: Len;
  font?: string;
  color?: string;
  background?: string;
  opacity?: number;
  transform?: string;
  transformOrigin?: string;
  clipPath?: string;
  verticalAlign?: string;
  boxShadow?: string;
  textShadow?: string;
  WebkitTextStroke?: string;
  paintOrder?: string;
}

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

// --- what the render draws, so the Finish preview draws the same ---------------------------------
// Sizes are pixels of the render's frame: the long video's are of 1080 tall, the Reels line's of
// 1080 wide. Each helper scales them to the frame it is given, so the render (k = 1) and the
// preview (a stage a few hundred pixels wide) place the same thing on the same spot.

/** The captions' colours and font (@wren/video `DEFAULT_LOOK`, kept equal by a test). */
export const CAPTION_LOOK = {
  foreground: "#0e0e0e",
  accent: "#7969a3",
  font: '"General Sans", ui-sans-serif, system-ui, sans-serif',
} as const;

/** The `stress` style's heavier face: a system serif, so renders stay offline. */
const STRESS_FONT = 'Georgia, "Times New Roman", serif';

/** The long video's corner camera: a square this big, this far from the bottom right corner. */
export const CORNER_CAM = { size: 340, margin: 40, radius: 28 } as const;

/** The corner camera's box in a `w` x `h` long frame. */
export function cornerCam(w: number, h: number): CSSProperties {
  const k = h / 1080;
  const size = CORNER_CAM.size * k;
  const m = CORNER_CAM.margin * k;
  return {
    position: "absolute",
    left: w - m - size,
    top: h - m - size,
    width: size,
    height: size,
    borderRadius: CORNER_CAM.radius * k,
    overflow: "hidden",
    boxShadow: `0 ${8 * k}px ${30 * k}px rgba(0,0,0,0.35)`,
  };
}

/** The long video's caption line: font size, line height, widest line, and the gap under it. */
const LONG_CAPTION = { size: 54, lineHeight: 1.25, maxWidth: 1180, bottom: 90, band: 240 };

/**
 * The long video's caption block in a `w` x `h` frame: `box` (on the bottom unless he placed it,
 * then its middle at `place` of the height) holds `text`, the line's look.
 */
export function longCaption(
  w: number,
  h: number,
  place: number | undefined,
  font: string,
): { box: CSSProperties; text: CSSProperties; size: number } {
  const k = h / 1080;
  const size = LONG_CAPTION.size * k;
  const box: CSSProperties =
    place === undefined
      ? {
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: LONG_CAPTION.bottom * k,
        }
      : {
          position: "absolute",
          left: 0,
          right: 0,
          top: place * h - (LONG_CAPTION.band / 2) * k,
          height: LONG_CAPTION.band * k,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
        };
  return {
    box,
    size,
    text: {
      maxWidth: Math.min(w, LONG_CAPTION.maxWidth * k),
      textAlign: "center",
      font: `700 ${size}px/${LONG_CAPTION.lineHeight} ${font}`,
      color: "#fff",
      textShadow: `0 ${2 * k}px ${12 * k}px rgba(0,0,0,0.7)`,
    },
  };
}

/**
 * The Reels line (vertical, square, portrait and Shorts): about 80 px bold, white with a dark
 * outline, kept clear of the Reels/Shorts UI on the right. A line past `maxChars` shrinks.
 */
const REEL_CAPTION = {
  size: 80,
  minScale: 0.6,
  lineHeight: 1.15,
  left: 108,
  right: 162,
  band: 240,
  stroke: 10,
};

/** Where a full-frame Reels line's middle sits in an `h` tall frame: 66% down unless he moved it. */
export const reelY = (h: number, place: { short?: number | undefined } | undefined) =>
  Math.round(h * (place?.short ?? CAPTION_Y.short));

/** The Reels line's box in a `w` wide frame, its middle at `y`; `chars` the line's length. */
export function reelCaption(
  w: number,
  y: number,
  chars: number,
  maxChars: number,
  font: string,
): { box: CSSProperties; size: number } {
  const k = w / 1080;
  const fit = Math.max(REEL_CAPTION.minScale, Math.min(1, maxChars / Math.max(1, chars)));
  const size = Math.round(REEL_CAPTION.size * fit * k);
  return {
    size,
    box: {
      position: "absolute",
      left: REEL_CAPTION.left * k,
      right: REEL_CAPTION.right * k,
      top: y - (REEL_CAPTION.band / 2) * k,
      height: REEL_CAPTION.band * k,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      font: `800 ${size}px/${REEL_CAPTION.lineHeight} ${font}`,
      color: "#fff",
      WebkitTextStroke: `${REEL_CAPTION.stroke * k}px rgba(0,0,0,0.85)`,
      paintOrder: "stroke fill",
      textShadow: `0 ${4 * k}px ${18 * k}px rgba(0,0,0,0.55)`,
    },
  };
}

/**
 * One caption word in its style (`st` from `wordState`): the word's own look, and for sweep the
 * accent bar behind it. `size` is its line's font size.
 */
export function captionWordLook(
  style: string,
  st: WordState,
  o: { stressed: boolean; size: number; accent: string },
): { word: CSSProperties; fill?: CSSProperties } {
  const { size, accent } = o;
  const radius = Math.round(size * 0.16);
  const base: CSSProperties = {
    display: "inline-block",
    position: "relative",
    padding: `0 ${Math.round(size * 0.15)}px`,
    borderRadius: radius,
  };
  switch (style) {
    case "pill":
      return { word: { ...base, color: `rgba(255,255,255,${0.42 + 0.58 * st.lit})` } };
    case "sweep":
      return {
        word: base,
        fill: {
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          background: accent,
          opacity: st.fill,
          transform: `scaleX(${st.fillScaleX})`,
          transformOrigin: "0% 50%",
        },
      };
    case "pop":
      return { word: { ...base, opacity: st.opacity, transform: `scaleX(${st.scaleX})` } };
    case "wipe":
      return {
        word: { ...base, opacity: st.opacity, clipPath: `inset(-20% ${st.clip * 100}% -20% 0)` },
      };
    case "stress":
      return {
        word: {
          ...base,
          opacity: st.opacity,
          transform: `scale(${st.scale})`,
          transformOrigin: "0% 100%",
          ...(o.stressed
            ? {
                font: `italic 800 ${Math.round(size * 1.4)}px/1 ${STRESS_FONT}`,
                verticalAlign: "baseline",
              }
            : {}),
        },
      };
    default:
      return { word: { ...base, background: st.fill ? accent : "transparent" } };
  }
}

/** Pill's dark pill around a line of `size` px words. */
export const pillLook = (size: number, foreground: string): CSSProperties => ({
  display: "inline-block",
  padding: `${Math.round(size * 0.22)}px ${Math.round(size * 0.5)}px`,
  borderRadius: Math.round(size * 0.36),
  background: `${foreground}d9`,
  boxShadow: "0 4px 18px rgba(0,0,0,0.25)",
  textShadow: "none",
  WebkitTextStroke: "0",
});
