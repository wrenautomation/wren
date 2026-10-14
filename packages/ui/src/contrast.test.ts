import { describe, expect, it } from "vitest";
import { failingPairs, lookColors, NEED, pairsOf, ratioOf } from "./contrast.js";
import { VARIANTS } from "./palette-brand.js";
import { PRESETS, readTheme, SHOWCASE, type Theme } from "./theme.js";

const said = (look: Theme) =>
  failingPairs(look).map((p) => `${p.text} on ${p.on} ${p.ratio.toFixed(2)}:1`);

describe("every text color on every ground", () => {
  it.each(Object.entries({ ...PRESETS, ...SHOWCASE }))("reads at 4.5:1 in %s", (_name, look) => {
    expect(said(look)).toEqual([]);
  });

  // Client looks come from a brand color: any color, any variant, either scheme.
  const COLORS = ["#7969a3", "#ff0000", "#ffd400", "#00c2a8", "#0b0d14", "#f6f3e8", "#808080"];
  it.each(COLORS)("reads at 4.5:1 in a look made from %s", (color) => {
    for (const variant of VARIANTS)
      for (const scheme of ["light", "dark"] as const)
        for (const preset of ["wren", "riso"])
          expect(
            said(readTheme({ preset, brand: { color, variant, scheme } })),
            `${variant} ${scheme} ${preset}`,
          ).toEqual([]);
  });

  it("checks each pair on every ground", () => {
    expect(pairsOf({}).length).toBe(10 * 17 + 3);
    expect(pairsOf({}).every((p) => p.ratio >= NEED)).toBe(true);
  });
});

describe("lookColors", () => {
  it("reads hex, rgb and color-mix as tailwind.css writes them", () => {
    const c = lookColors({ paper: "#fff", ink: "#000", tile: "rgb(255 255 255 / 0.045)" });
    expect(c("fill")).toEqual([0, 0, 0, 0.06]);
    expect(c("tile")).toEqual([255, 255, 255, 0.045]);
    expect(c("wash")[3]).toBe(1);
  });

  it("gives WCAG's ratio", () => {
    expect(ratioOf([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
    expect(ratioOf([118, 118, 118, 1], [255, 255, 255, 1])).toBeGreaterThan(4.5);
  });

  it("fails a gray that reads under 4.5:1", () => {
    expect(said({ "ink-3": "#9c9c96" }).length).toBeGreaterThan(0);
  });
});
