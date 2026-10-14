/**
 * A look from one brand color. Material Color Utilities builds tonal palettes in HCT, a
 * perceptual color space, and its dynamic scheme roles map onto the kit's tokens. Then every
 * pair that carries text is checked against WCAG 2.1, and a pair that fails has its text stepped
 * in tone until it passes, so any color in gives a theme that reads. Pure: the browser and the
 * tests get the same theme for the same input.
 */
import {
  argbFromHex,
  argbFromRgb,
  Blend,
  Contrast,
  type DynamicScheme,
  Hct,
  hexFromArgb,
  lstarFromArgb,
  QuantizerCelebi,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeTonalSpot,
  SchemeVibrant,
  Score,
  sanitizeDegreesDouble,
  TonalPalette,
} from "@material/material-color-utilities";
import { type GROUNDS, NEED, pairsOf } from "./contrast.js";
import type { Theme, Token } from "./theme.js";

/** MCU's scheme variants. `tonal_spot` is calm; `fidelity` stays closest to the brand color. */
const SCHEMES = {
  tonal_spot: SchemeTonalSpot,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  fidelity: SchemeFidelity,
  content: SchemeContent,
  neutral: SchemeNeutral,
  monochrome: SchemeMonochrome,
} satisfies Record<string, new (source: Hct, dark: boolean, contrast: number) => DynamicScheme>;

export type Variant = keyof typeof SCHEMES;
export const VARIANTS = Object.keys(SCHEMES) as Variant[];

/** The chart hues after the brand's, as turns from it in degrees: chart-2, chart-3, chart-4. */
const HARMONY = {
  analogous: [30, -30, 60],
  complementary: [180, 30, 210],
  split: [150, -150, 30],
  triadic: [120, -120, 60],
  tetradic: [90, 180, 270],
} satisfies Record<string, [number, number, number]>;

export type Harmony = keyof typeof HARMONY;
export const HARMONIES = Object.keys(HARMONY) as Harmony[];

/** MCU's contrast levels: standard, medium, high. */
export const CONTRASTS = [0, 0.5, 1] as const;

export interface BrandInput {
  color: string;
  variant: Variant;
  harmony: Harmony;
  contrast: number;
  scheme: "light" | "dark";
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A brand from stored or typed-in data, defaults filled in; null without a usable color. */
export function readBrand(raw: unknown): BrandInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const color = typeof b.color === "string" ? b.color.trim().toLowerCase() : "";
  if (!HEX.test(color)) return null;
  const one = <T>(all: readonly T[], v: unknown, or: T): T =>
    all.includes(v as T) ? (v as T) : or;
  return {
    color,
    variant: one(VARIANTS, b.variant, "tonal_spot"),
    harmony: one(HARMONIES, b.harmony, "analogous"),
    contrast: one<number>(CONTRASTS, b.contrast, 0),
    scheme: b.scheme === "dark" ? "dark" : "light",
  };
}

/** Where text sits: one of the grounds `contrast.ts` checks, or the accent for on-accent. */
export type Ground = (typeof GROUNDS)[number] | "accent";

/**
 * Text colors in the order they're stepped. The accent goes first: the tints it makes are
 * grounds for the rest.
 */
const STEPPED: Token[] = ["accent", "ink", "ink-2", "ink-3", "good-ink", "warn-ink", "bad"];

export interface ContrastLine {
  text: Token;
  /** Its weakest ground. */
  on: Ground;
  need: number;
  ratio: number;
  /** The color the scheme gave the text, when it failed and was stepped to pass. */
  was?: string;
}

/** The green a good result shows in, and the amber a wait shows in, harmonized toward the brand. */
const GREEN = 0xff2e7d32;
const AMBER = 0xffb7791f;
const BLACK = 0xff000000;
const WHITE = 0xffffffff;

const ratio = (a: number, b: number) => Contrast.ratioOfTones(lstarFromArgb(a), lstarFromArgb(b));

/**
 * `text` stepped in HCT tone, a point at a time, toward black or white, whichever is further from
 * `ground`, until it reads at `need`. Unchanged when it already does. One end always passes 4.5:1.
 */
export function stepToPass(text: number, ground: number, need: number): number {
  if (ratio(text, ground) >= need) return text;
  const step = ratio(BLACK, ground) >= ratio(WHITE, ground) ? -1 : 1;
  const { hue, chroma, tone } = Hct.fromInt(text);
  let out = text;
  for (let t = Math.round(tone) + step; t >= 0 && t <= 100; t += step) {
    out = Hct.from(hue, chroma, t).toInt();
    if (ratio(out, ground) >= need) break;
  }
  return out;
}

/** The theme `brand` makes, every text pair passing, and how each pair came out. */
export function brandTheme(brand: BrandInput): { theme: Theme; report: ContrastLine[] } {
  const source = argbFromHex(brand.color);
  const dark = brand.scheme === "dark";
  const s = new SCHEMES[brand.variant](Hct.fromInt(source), dark, brand.contrast);
  const good = Blend.harmonize(GREEN, source);
  const warn = Blend.harmonize(AMBER, source);
  const c: Partial<Record<Token, number>> = {
    canvas: s.surface,
    paper: dark ? s.surfaceContainer : s.surfaceContainerLowest,
    tile: s.surfaceContainerHigh,
    ink: s.onSurface,
    "ink-2": s.onSurfaceVariant,
    "ink-3": s.outline,
    accent: s.primary,
    "on-accent": s.onPrimary,
    good,
    "good-ink": TonalPalette.fromInt(good).tone(dark ? 80 : 30),
    bad: s.error,
    warn,
    "warn-ink": TonalPalette.fromInt(warn).tone(dark ? 80 : 35),
    shade: s.shadow,
  };
  const colors = (): Theme => {
    const t: Theme = { scheme: brand.scheme };
    for (const [k, v] of Object.entries(c)) t[k as Token] = hexFromArgb(v);
    return t;
  };
  const weakest = (text: Token) =>
    pairsOf(colors())
      .filter((p) => p.text === text)
      .reduce((a, b) => (b.ratio < a.ratio ? b : a));

  // Each text color steps in tone, away from the paper, until its weakest ground reads.
  const was: Partial<Record<Token, number>> = {};
  for (const text of STEPPED) {
    const start = c[text] ?? BLACK;
    const { hue, chroma, tone } = Hct.fromInt(start);
    for (let t = Math.round(tone); weakest(text).ratio < NEED && t >= 0 && t <= 100; ) {
      t += dark ? 1 : -1;
      c[text] = Hct.from(hue, chroma, t).toInt();
    }
    if (c[text] !== start) was[text] = start;
  }
  const onAccent = stepToPass(c["on-accent"] ?? WHITE, c.accent ?? BLACK, NEED);
  if (onAccent !== c["on-accent"]) {
    was["on-accent"] = c["on-accent"] ?? WHITE;
    c["on-accent"] = onAccent;
  }

  // Chart series: the accent (chart-1 follows it in CSS), the harmony's hues, a neutral.
  const tone = dark ? 70 : 50;
  const chroma = Math.max(s.primaryPalette.chroma, 36);
  const hue = Hct.fromInt(source).hue;
  const theme = colors();
  HARMONY[brand.harmony].forEach((turn, i) => {
    const p = TonalPalette.fromHueAndChroma(sanitizeDegreesDouble(hue + turn), chroma);
    theme[`chart-${i + 2}` as Token] = hexFromArgb(p.tone(tone));
  });
  theme["chart-5"] = hexFromArgb(s.neutralVariantPalette.tone(tone));

  const line = (text: Token, on: Ground, r: number): ContrastLine => {
    const w = was[text];
    return { text, on, need: NEED, ratio: r, ...(w !== undefined ? { was: hexFromArgb(w) } : {}) };
  };
  const report = STEPPED.map((text) => {
    const p = weakest(text);
    return line(text, p.on as Ground, p.ratio);
  });
  report.push(line("on-accent", "accent", ratio(c["on-accent"] ?? WHITE, c.accent ?? BLACK)));
  return { theme, report };
}

/** Google's blue: what MCU's Score gives back when nothing in the image qualifies. */
const FALLBACK = 0xff4285f4;

/** Up to four brand colors from an image's RGBA bytes, best first; transparent pixels skipped. */
export function brandColorsOf(rgba: ArrayLike<number>): string[] {
  const pixels: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4)
    if (rgba[i + 3] === 255)
      pixels.push(argbFromRgb(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0));
  if (!pixels.length) return [];
  const counts = QuantizerCelebi.quantize(pixels, 128);
  return Score.score(counts, { desired: 4, filter: true })
    .filter((c) => c !== FALLBACK || counts.has(c))
    .map(hexFromArgb);
}
