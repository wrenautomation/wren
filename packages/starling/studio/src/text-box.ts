/**
 * Where text sits on a rendered frame, from the same Figtree 800 file the compositions load
 * (`compositions/index.tsx`), so the checks and the render agree on its width.
 * Design: designs/2026-11-10-studio-quality-floor.md.
 */
import { createRequire } from "node:module";
import { type Font, openSync } from "fontkit";
import { BIG_TYPE, OVERLAY, overlayAt, type TextOverlay } from "./finish-look.js";

const FONT_FILE = "@fontsource/figtree/files/figtree-latin-800-normal.woff2";
/** CSS `text-wrap: balance` balances up to this many lines; more wrap greedily. */
const BALANCE_MAX_LINES = 6;

let font: Font | null = null;
function figtree(): Font {
  if (!font) {
    const f = openSync(createRequire(import.meta.url).resolve(FONT_FILE));
    if (!("layout" in f)) throw new Error(`${FONT_FILE}: a font collection, not one font`);
    font = f;
  }
  return font;
}

/** px wide at `size` px, kerned; CSS letter-spacing `spacing` px goes after every character. */
export function textWidth(text: string, size: number, spacing = 0): number {
  const f = figtree();
  return (f.layout(text).advanceWidth / f.unitsPerEm) * size + spacing * [...text].length;
}

/** Lines as `text-wrap: balance` sets them in a `maxWidth` box: the greedy line count at the narrowest width that keeps it. */
export function balancedLines(
  text: string,
  size: number,
  spacing: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const wrap = (w: number) => {
    const lines: string[] = [];
    for (const word of words) {
      const last = lines.at(-1);
      if (last !== undefined && textWidth(`${last} ${word}`, size, spacing) <= w)
        lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
    }
    return lines;
  };
  const greedy = wrap(maxWidth);
  if (greedy.length < 2 || greedy.length > BALANCE_MAX_LINES) return greedy;
  let [lo, hi] = [0, maxWidth];
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (wrap(mid).length > greedy.length) lo = mid;
    else hi = mid;
  }
  return wrap(hi);
}

/** A box in frame px: left, top, width, height. */
export type Box = [number, number, number, number];

/** An overlay's text box at full opacity in a `w` x `h` frame. */
export function overlayBox(o: TextOverlay, w: number, h: number): Box {
  const at = overlayAt(o, (o.from + o.to) / 2, w, h);
  if (!at) throw new Error(`overlay "${o.text}" has no time on screen`);
  const spacing = at.size * OVERLAY.tracking;
  const lines = balancedLines(o.text, at.size, spacing, at.width);
  const bw = Math.max(...lines.map((l) => textWidth(l, at.size, spacing)));
  const bh = lines.length * at.size * OVERLAY.lineHeight;
  return [at.x - bw / 2, at.y - bh / 2, bw, bh];
}

/** The big word's box (one line, never wrapped), at its resting scale. */
export function bigWordBox(place: { text: string; x: number; y: number; size: number }): Box {
  const bw = textWidth(place.text, place.size, place.size * BIG_TYPE.tracking);
  const bh = place.size * BIG_TYPE.lineHeight;
  return [place.x - bw / 2, place.y - bh / 2, bw, bh];
}
