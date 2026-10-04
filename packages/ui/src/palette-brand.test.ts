import {
  argbFromHex,
  argbFromRgb,
  blueFromArgb,
  Contrast,
  greenFromArgb,
  hexFromArgb,
  lstarFromArgb,
  redFromArgb,
} from "@material/material-color-utilities";
import { describe, expect, it } from "vitest";
import {
  type BrandInput,
  brandColorsOf,
  brandTheme,
  HARMONIES,
  readBrand,
  stepToPass,
  VARIANTS,
} from "./palette-brand.js";
import { readTheme, TOKENS, type Token } from "./theme.js";

const COLORS = {
  "very light": "#f6f3e8",
  "very dark": "#0b0d14",
  "saturated red": "#ff0000",
  gray: "#808080",
  "the Wren accent": "#a83b12",
};

/** Contrast read back from the theme itself, not from the report. */
const ratio = (a: string, b: number) =>
  Contrast.ratioOfTones(lstarFromArgb(argbFromHex(a)), lstarFromArgb(b));
const over = (hex: string, share: number, paper: string) => {
  const [c, p] = [argbFromHex(hex), argbFromHex(paper)];
  const m = (f: (n: number) => number) => Math.round(f(c) * share + f(p) * (1 - share));
  return argbFromRgb(m(redFromArgb), m(greenFromArgb), m(blueFromArgb));
};
const PAIRS: [Token, Token | [Token, number], number][] = [
  ["ink", "canvas", 4.5],
  ["ink", "paper", 4.5],
  ["ink-2", "canvas", 4.5],
  ["ink-2", "paper", 4.5],
  ["ink-3", "canvas", 3],
  ["ink-3", "paper", 3],
  ["on-accent", "accent", 4.5],
  ["good-ink", ["good", 0.1], 4.5],
  ["bad", ["bad", 0.06], 4.5],
];

const brand = (color: string, more: Partial<BrandInput> = {}): BrandInput => ({
  color,
  variant: "tonal_spot",
  harmony: "analogous",
  contrast: 0,
  scheme: "light",
  ...more,
});

describe("brandTheme", () => {
  describe.each(Object.entries(COLORS))("%s", (_name, color) => {
    it.each(["light", "dark"] as const)("passes every check in %s", (scheme) => {
      const { theme, report } = brandTheme(brand(color, { scheme }));
      const t = (k: Token) => theme[k] as string;
      for (const [text, on, need] of PAIRS) {
        const ground = Array.isArray(on) ? over(t(on[0]), on[1], t("paper")) : argbFromHex(t(on));
        expect(ratio(t(text), ground), `${text} on ${on}`).toBeGreaterThanOrEqual(need);
      }
      for (const line of report) expect(line.ratio).toBeGreaterThanOrEqual(line.need);
      expect(theme.scheme).toBe(scheme);
    });

    it("passes in every variant, contrast and scheme", () => {
      for (const variant of VARIANTS)
        for (const contrast of [0, 0.5, 1])
          for (const scheme of ["light", "dark"] as const) {
            const { report } = brandTheme(brand(color, { variant, contrast, scheme }));
            for (const l of report)
              expect(
                l.ratio,
                `${variant} ${contrast} ${scheme} ${l.text} on ${l.on}`,
              ).toBeGreaterThanOrEqual(l.need);
          }
    });
  });

  it("sets only known tokens, as hex", () => {
    const { theme } = brandTheme(brand("#1d5a45"));
    const known = new Set<string>(TOKENS);
    for (const [k, v] of Object.entries(theme)) {
      expect(known.has(k), k).toBe(true);
      if (k !== "scheme") expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const k of ["canvas", "paper", "tile", "accent", "chart-2", "chart-5"] as const)
      expect(theme[k]).toBeDefined();
  });

  it("gives four different chart colors after the accent, for every harmony", () => {
    for (const harmony of HARMONIES) {
      const { theme } = brandTheme(brand("#1d5a45", { harmony }));
      const charts = [theme["chart-2"], theme["chart-3"], theme["chart-4"], theme["chart-5"]];
      expect(new Set(charts).size, harmony).toBe(4);
    }
  });

  it("steps a failing text color until it passes, and leaves a passing one", () => {
    const white = argbFromHex("#ffffff");
    const gray = argbFromHex("#8a8a8a");
    const fixed = stepToPass(gray, white, 4.5);
    expect(ratio(hexFromArgb(gray), white)).toBeLessThan(4.5);
    expect(ratio(hexFromArgb(fixed), white)).toBeGreaterThanOrEqual(4.5);
    expect(lstarFromArgb(fixed)).toBeLessThan(lstarFromArgb(gray));
    const onBlack = stepToPass(gray, argbFromHex("#000000"), 7);
    expect(lstarFromArgb(onBlack)).toBeGreaterThan(lstarFromArgb(gray));
    expect(stepToPass(argbFromHex("#222222"), white, 4.5)).toBe(argbFromHex("#222222"));
  });

  it("gives the same theme for the same input", () => {
    const input = brand("#3a7bd5", { variant: "vibrant", harmony: "triadic", scheme: "dark" });
    expect(brandTheme(input)).toEqual(brandTheme({ ...input }));
  });
});

describe("readBrand", () => {
  it("fills the defaults", () => {
    expect(readBrand({ color: "#1D5A45" })).toEqual(brand("#1d5a45"));
  });

  it("drops what it can't use", () => {
    expect(readBrand({ color: "red" })).toBeNull();
    expect(readBrand({ color: "url(x)" })).toBeNull();
    expect(readBrand("#1d5a45")).toBeNull();
    expect(readBrand(null)).toBeNull();
    expect(readBrand({ color: "#123", variant: "loud", harmony: 3, contrast: 0.7 })).toEqual(
      brand("#123"),
    );
  });
});

describe("readTheme with a brand", () => {
  it("derives the colors", () => {
    expect(readTheme({ brand: { color: "#1d5a45" } })).toEqual(brandTheme(brand("#1d5a45")).theme);
  });

  it("lets a typed token beat a derived one", () => {
    const t = readTheme({ brand: { color: "#1d5a45" }, accent: "#123456", "chart-3": "#abcdef" });
    expect(t.accent).toBe("#123456");
    expect(t["chart-3"]).toBe("#abcdef");
    expect(t.ink).toBe(brandTheme(brand("#1d5a45")).theme.ink);
  });

  it("keeps a preset's type and shape, and drops its made colors for the brand's", () => {
    const t = readTheme({ preset: "night", brand: { color: "#1d5a45", scheme: "light" } });
    expect(t.wash).toBeUndefined();
    expect(t.scrim).toBeUndefined();
    expect(t.canvas).toBe(brandTheme(brand("#1d5a45")).theme.canvas);
    expect(readTheme({ preset: "soft", brand: { color: "#1d5a45" } }).radius).toBe("12px");
  });

  it("ignores a brand it can't read", () => {
    expect(readTheme({ preset: "night", brand: { color: "nope" } })).toEqual(readTheme("night"));
  });
});

describe("brandColorsOf", () => {
  const image = (colors: [number, number, number, number][]) =>
    Uint8ClampedArray.from(colors.flatMap((c) => Array(50).fill(c).flat()));

  it("finds the logo's colors and skips see-through pixels", () => {
    const got = brandColorsOf(
      image([
        [29, 90, 69, 255],
        [29, 90, 69, 255],
        [200, 40, 30, 255],
        [255, 0, 255, 0],
      ]),
    );
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThanOrEqual(4);
    expect(got).not.toContain("#ff00ff");
  });

  it("finds nothing in a clear or gray image", () => {
    expect(brandColorsOf(image([[0, 0, 0, 0]]))).toEqual([]);
    expect(brandColorsOf(image([[128, 128, 128, 255]]))).toEqual([]);
  });
});
