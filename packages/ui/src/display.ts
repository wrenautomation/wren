/**
 * How a viewer sets the frame for himself, kept in his prefs (`DISPLAY_PREF`): the sidebar's and
 * the page column's widths, either folded away, how tight rows sit, the text size, the canvas
 * around the window, the counts, the motion. Pure, so the server's copy and the browser's read
 * the same way (designs/2026-10-11-portal-polish.md).
 */

export const DISPLAY_PREF = "display";
/** His own look over Wren's workspace: anything `readTheme` reads (designs/2026-10-04-brand-palette.md). */
export const LOOK_PREF = "look";

export type Density = "roomy" | "snug";
export type TextSize = "small" | "normal" | "large";
export type Motion = "system" | "less";

export interface Display {
  /** The sidebar's width, open. */
  side: number;
  /** Folded to its icons. */
  sideShut: boolean;
  /** The open app's page column's width, open. */
  pages: number;
  pagesShut: boolean;
  density: Density;
  text: TextSize;
  /** The canvas around the window; off, the window meets the screen's edges. */
  frame: boolean;
  /** What waits in each app, beside it in the sidebar. */
  counts: boolean;
  motion: Motion;
}

export const DISPLAY: Display = {
  side: 190,
  sideShut: false,
  pages: 208,
  pagesShut: false,
  density: "roomy",
  text: "normal",
  frame: true,
  counts: true,
  motion: "system",
};

/** Widths a drag stays in; past `fold` toward the window, the panel folds instead. */
export const SIDE = { min: 184, max: 360, shut: 60, fold: 140 } as const;
export const PAGES = { min: 160, max: 320, fold: 110 } as const;

export const ZOOM: Readonly<Record<TextSize, number>> = { small: 0.92, normal: 1, large: 1.08 };

const DENSITIES: readonly Density[] = ["roomy", "snug"];
const TEXTS: readonly TextSize[] = ["small", "normal", "large"];
const MOTIONS: readonly Motion[] = ["system", "less"];

const clamp = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, n)));
const width = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : d;
const flag = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const oneOf = <T extends string>(v: unknown, of: readonly T[], d: T): T =>
  of.includes(v as T) ? (v as T) : d;

/** A stored value as a whole Display: anything missing or out of range is the default. */
export function readDisplay(v: unknown): Display {
  const o =
    typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return {
    side: width(o.side, SIDE.min, SIDE.max, DISPLAY.side),
    sideShut: flag(o.sideShut, DISPLAY.sideShut),
    pages: width(o.pages, PAGES.min, PAGES.max, DISPLAY.pages),
    pagesShut: flag(o.pagesShut, DISPLAY.pagesShut),
    density: oneOf(o.density, DENSITIES, DISPLAY.density),
    text: oneOf(o.text, TEXTS, DISPLAY.text),
    frame: flag(o.frame, DISPLAY.frame),
    counts: flag(o.counts, DISPLAY.counts),
    motion: oneOf(o.motion, MOTIONS, DISPLAY.motion),
  };
}

/** Only what differs from the defaults: what's kept. Nothing differs, nothing is kept (null). */
export function displayDiff(d: Display): Partial<Display> | null {
  const out: Partial<Display> = {};
  for (const k of Object.keys(DISPLAY) as (keyof Display)[])
    if (d[k] !== DISPLAY[k]) Object.assign(out, { [k]: d[k] });
  return Object.keys(out).length ? out : null;
}

/** The frame's CSS variables for a Display. */
export function displayVars(d: Display): Record<string, string> {
  return {
    "--layout-side": `${d.sideShut ? SIDE.shut : d.side}px`,
    "--layout-pages": `${d.pages}px`,
    "--layout-zoom": String(ZOOM[d.text]),
    ...(d.frame ? {} : { "--ui-frame": "0px" }),
  };
}

/** Where a drag let go: a width in range, or folded when pulled past `fold`. */
export function dragged(
  px: number,
  range: { min: number; max: number; fold: number },
): { width: number; shut: boolean } {
  if (px < range.fold) return { width: range.min, shut: true };
  return { width: clamp(px, range.min, range.max), shut: false };
}
