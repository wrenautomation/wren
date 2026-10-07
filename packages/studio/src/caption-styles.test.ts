import { describe, expect, it } from "vitest";
import { bigWordState, CAPTION_STYLES, DIM, ENTRY_S, wordState } from "./caption-styles.js";

// A word said from 1.0 to 1.4 s; the next word of its line starts at 1.5 s.
const w = { s: 1, e: 1.4 };
const until = 1.5;
const at = (style: string, t: number, first = false) => wordState(style, w, t, until, { first });

describe("caption word states", () => {
  it("every style walks before, entering, said, done on the frame clock", () => {
    for (const style of CAPTION_STYLES) {
      expect(at(style, 0.9).phase).toBe("before");
      const entry = ENTRY_S[style as keyof typeof ENTRY_S] ?? 0;
      if (entry) expect(at(style, 1 + entry / 2).phase).toBe("entering");
      expect(at(style, 1.35).phase).toBe("said");
      expect(at(style, 1.6).phase).toBe("done");
    }
  });

  it("word: the accent sits behind the said word until the next one starts", () => {
    expect(at("word", 0.9).fill).toBe(0);
    expect(at("word", 1.45).fill).toBe(1);
    expect(at("word", 1.5).fill).toBe(0);
  });

  it("pill: unsaid grey, lit as it's said and after; the line's first word lit at once", () => {
    expect(at("pill", 0.9).lit).toBe(0);
    expect(at("pill", 1).lit).toBeCloseTo(0.5);
    expect(at("pill", 1.2).lit).toBe(1);
    expect(at("pill", 2).lit).toBe(1);
    expect(at("pill", 0, true).lit).toBe(1);
  });

  it("sweep: the accent grows in from the left, then fades from the word's end", () => {
    expect(at("sweep", 0.9).fill).toBe(0);
    const mid = at("sweep", 1.05);
    expect(mid.fill).toBeGreaterThan(0);
    expect(mid.fill).toBeLessThan(1);
    expect(mid.fillScaleX).toBeLessThan(1);
    expect(at("sweep", 1.3).fill).toBe(1);
    expect(at("sweep", 1.45).fill).toBeLessThan(1);
    expect(at("sweep", 1.6).fill).toBe(0);
  });

  it("pop: hidden, then squeezes in from 70% width within 4 frames", () => {
    expect(at("pop", 0.9)).toMatchObject({ opacity: 0, scaleX: 0.7 });
    const mid = at("pop", 1 + 1 / 30);
    expect(mid.scaleX).toBeGreaterThan(0.7);
    expect(mid.scaleX).toBeLessThan(1);
    expect(at("pop", 1 + 4 / 30)).toMatchObject({ opacity: 1, scaleX: 1 });
  });

  it("wipe: clipped from the right, wiped in over 0.3 s, dimmed once the next word starts", () => {
    expect(at("wipe", 0.9).clip).toBe(1);
    expect(at("wipe", 1.15).clip).toBeGreaterThan(0);
    expect(at("wipe", 1.15).clip).toBeLessThan(1);
    expect(at("wipe", 1.3)).toMatchObject({ clip: 0, opacity: 1 });
    expect(at("wipe", 1.8).opacity).toBeCloseTo(DIM);
  });

  it("stress: fades in and settles from 112%, then stays", () => {
    expect(at("stress", 0.9)).toMatchObject({ opacity: 0, scale: 1.12 });
    expect(at("stress", 1.1)).toMatchObject({ opacity: 1, scale: 1 });
    expect(at("stress", 3).opacity).toBe(1);
  });

  it("an unknown style draws as word", () => {
    expect(at("neon", 1.2).fill).toBe(1);
  });
});

describe("big word", () => {
  it("in from its start, out over the last 0.3 s, gone outside", () => {
    expect(bigWordState(0.9, 1, 3).opacity).toBe(0);
    expect(bigWordState(1.1, 1, 3).opacity).toBeGreaterThan(0);
    expect(bigWordState(1.1, 1, 3).scale).toBeGreaterThan(1);
    expect(bigWordState(2, 1, 3).opacity).toBe(1);
    expect(bigWordState(2, 1, 3).scale).toBeCloseTo(1);
    expect(bigWordState(2.85, 1, 3).opacity).toBeLessThan(1);
    expect(bigWordState(3, 1, 3).opacity).toBe(0);
  });
});
