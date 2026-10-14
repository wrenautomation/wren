/**
 * Every text color on every ground a look makes, by WCAG 2.1: 4.5:1 for all text, no large-text
 * exception (designs/2026-10-14-customerio-audit.md, B3 item 10). The grounds that tailwind.css
 * mixes (tile, wash, band, the tints) are mixed here the same way, then laid on paper or canvas.
 */
import { BASE, type Theme, type Token } from "./theme.js";

/** The ratio all text needs. */
export const NEED = 4.5;

/** Colors that carry text on the kit's grounds. */
export const TEXTS = [
  "ink",
  "ink-2",
  "ink-3",
  "accent",
  "link",
  "active",
  "live",
  "good-ink",
  "warn-ink",
  "bad",
] as const;

/** Where text sits. A see-through ground is laid on paper, and on canvas too where noted. */
export const GROUNDS = [
  "canvas",
  "paper",
  "ground",
  "tile",
  "wash",
  "band",
  "fill",
  "fill/canvas",
  "fill/tile",
  "hover",
  "accent-wash",
  "accent-tint",
  "accent-tint/canvas",
  "good-tint",
  "bad-tint",
  "warn-tint",
  "warn-tint/canvas",
] as const;

/** Pairs outside the grid: text on a filled ground. */
const FILLED: [Token, Token][] = [
  ["on-accent", "accent"],
  ["on-accent", "primary"],
  ["on-ink", "ink"],
];

type Rgba = [number, number, number, number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+)(%?))?\s*\)$/i;
const MIX = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/i;

/** `share` of `a` over `b`, premultiplied as color-mix in srgb mixes. */
function mix(a: Rgba, share: number, b: Rgba): Rgba {
  const alpha = a[3] * share + b[3] * (1 - share);
  if (!alpha) return [0, 0, 0, 0];
  const ch = (i: number) => ((a[i] ?? 0) * a[3] * share + (b[i] ?? 0) * b[3] * (1 - share)) / alpha;
  return [ch(0), ch(1), ch(2), alpha];
}

/** `top` laid on an opaque `under`. */
const over = (top: Rgba, under: Rgba): Rgba => {
  const a = top[3];
  return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (under[i] ?? 0) * (1 - a)).concat(1) as Rgba;
};

/** The defaults tailwind.css makes from the set tokens (its `:root`). */
const MADE: Theme = {
  tile: "var(--ui-canvas)",
  wash: "color-mix(in srgb, var(--ui-canvas) 50%, var(--ui-paper))",
  band: "color-mix(in srgb, var(--ui-tile) 75%, var(--ui-paper))",
  ground: "color-mix(in srgb, var(--ui-canvas) 45%, var(--ui-paper))",
  "on-ink": "var(--ui-paper)",
  primary: "var(--ui-accent)",
  active: "var(--ui-accent)",
  link: "var(--ui-accent)",
  live: "var(--ui-accent)",
  fill: "color-mix(in srgb, var(--ui-ink) 6%, transparent)",
  hover: "color-mix(in srgb, var(--ui-ink) 4.5%, transparent)",
  "accent-wash": "color-mix(in srgb, var(--ui-accent) 7%, transparent)",
  "accent-tint": "color-mix(in srgb, var(--ui-accent) 10%, transparent)",
  "good-tint": "color-mix(in srgb, var(--ui-good) 10%, transparent)",
  "bad-tint": "color-mix(in srgb, var(--ui-bad) 6%, transparent)",
  "warn-tint": "color-mix(in srgb, var(--ui-warn) 9%, transparent)",
};

/** A look's colors resolved: BASE, then the look, then what CSS makes from them. */
export function lookColors(look: Theme): (t: Token) => Rgba {
  const set: Theme = { ...BASE, ...MADE, ...look };
  const seen = new Map<string, Rgba>();
  const parse = (v: string): Rgba => {
    v = v.trim();
    if (v === "transparent") return [0, 0, 0, 0];
    const ref = /^var\(--ui-([a-z0-9-]+)\)$/.exec(v);
    if (ref) return token(ref[1] as Token);
    if (HEX.test(v)) {
      const h = v.length === 4 ? [...v.slice(1)].map((c) => c + c).join("") : v.slice(1);
      return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).concat(1) as Rgba;
    }
    const rgb = RGB.exec(v);
    if (rgb) {
      const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
      return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), a];
    }
    const m = MIX.exec(v);
    if (m) return mix(parse(m[1] ?? ""), Number(m[2]) / 100, parse(m[3] ?? ""));
    throw new Error(`Can't read the color ${v}`);
  };
  const token = (t: Token): Rgba => {
    const hit = seen.get(t);
    if (hit) return hit;
    const v = set[t];
    if (!v) throw new Error(`No ${t}`);
    const c = parse(v);
    seen.set(t, c);
    return c;
  };
  return token;
}

/** WCAG relative luminance of an opaque color. */
const luminance = ([r, g, b]: Rgba) => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export const ratioOf = (a: Rgba, b: Rgba) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

export interface Pair {
  text: Token;
  on: string;
  ratio: number;
}

/** Every text pair in `look`, each ground made opaque the way the page shows it. */
export function pairsOf(look: Theme): Pair[] {
  const c = lookColors(look);
  const paper = over(c("paper"), [255, 255, 255, 1]);
  const canvas = over(c("canvas"), [255, 255, 255, 1]);
  const tile = over(c("tile"), paper);
  const ground = (g: (typeof GROUNDS)[number]): Rgba => {
    const [name, under] = g.split("/") as [Token, string | undefined];
    const base = under === "canvas" ? canvas : under === "tile" ? tile : paper;
    if (name === "canvas") return canvas;
    if (name === "paper") return paper;
    return over(c(name), base);
  };
  const out: Pair[] = [];
  for (const text of TEXTS)
    for (const on of GROUNDS) {
      const g = ground(on);
      out.push({ text, on, ratio: ratioOf(over(c(text), g), g) });
    }
  for (const [text, on] of FILLED) {
    const g = over(c(on), paper);
    out.push({ text, on, ratio: ratioOf(over(c(text), g), g) });
  }
  return out;
}

/** The pairs under 4.5:1. */
export const failingPairs = (look: Theme): Pair[] => pairsOf(look).filter((p) => p.ratio < NEED);
