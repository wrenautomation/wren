import { describe, expect, it } from "vitest";
import { type AlignSegment, alignSegments, alignWords, mergeAligned } from "./align.js";
import type { Word } from "./schema.js";

const w = (text: string, s: number, e: number): Word => ({ w: text, s, e });

describe("alignSegments", () => {
  it("splits at sentence ends and pads each side up to its neighbours' words", () => {
    const words = [w("Hi", 0.2, 0.4), w("there.", 0.4, 0.9), w("Next", 1.1, 1.4), w("one", 1.4, 2)];
    expect(alignSegments(words)).toEqual([
      { from: 0, to: 2, s: 0, e: 1.1 },
      { from: 2, to: 4, s: 0.9, e: 2.5 },
    ]);
  });

  it("cuts a transcript with no stops every 15 s", () => {
    const words = Array.from({ length: 40 }, (_, i) => w("so", i, i + 0.5));
    const segs = alignSegments(words);
    expect(segs.map((g) => [g.from, g.to])).toEqual([
      [0, 16],
      [16, 32],
      [32, 40],
    ]);
  });

  it("keeps a closing quote or bracket after the stop", () => {
    const words = [w('"done."', 0, 1), w("then", 2, 3)];
    expect(alignSegments(words).map((g) => g.to)).toEqual([1, 2]);
  });
});

describe("mergeAligned", () => {
  const words = [w("a", 0, 1), w("b", 1, 3), w("c", 3, 4), w("d", 4, 6)];
  const one: AlignSegment[] = [{ from: 0, to: 4, s: 0, e: 6.5 }];

  it("takes the aligner's times, text untouched", () => {
    const out = mergeAligned(words, one, [
      [
        [0.1, 0.4],
        [0.5, 0.9],
        [3.2, 3.5],
        [4.4, 5.1],
      ],
    ]);
    expect(out).toEqual([w("a", 0.1, 0.4), w("b", 0.5, 0.9), w("c", 3.2, 3.5), w("d", 4.4, 5.1)]);
  });

  it("keeps whisper's times for a word it couldn't place, clamped between its neighbours", () => {
    const out = mergeAligned(words, one, [[[0.1, 0.4], null, [2.5, 3.5], [4.4, 5.1]]]);
    expect(out[1]).toEqual(w("b", 1, 2.5));
  });

  it("never lets an unplaced word run past the next placed one", () => {
    const out = mergeAligned(
      [w("x", 2, 3), w("y", 2.5, 3.5)],
      [{ from: 0, to: 2, s: 1, e: 4 }],
      [[null, [1.5, 1.8]]],
    );
    expect(out).toEqual([w("x", 1.5, 1.5), w("y", 1.5, 1.8)]);
  });

  it("leaves a segment whose count doesn't match, or that failed, as whisper had it", () => {
    const two: AlignSegment[] = [
      { from: 0, to: 2, s: 0, e: 3.5 },
      { from: 2, to: 4, s: 3, e: 6.5 },
    ];
    expect(mergeAligned(words, two, [[[0.1, 0.4]], null])).toEqual(words);
  });

  it("drops a backwards or non-finite pair, and keeps times in order", () => {
    const out = mergeAligned(words, one, [
      [
        [0.1, 0.4],
        [0.9, 0.5],
        [Number.NaN, 3.5],
        [3.8, 5.1],
      ],
    ]);
    expect(out.map((x) => [x.s, x.e])).toEqual([
      [0.1, 0.4],
      [1, 3],
      [3, 3.8],
      [3.8, 5.1],
    ]);
  });

  it("starts a placed word no earlier than the one before it ends", () => {
    const out = mergeAligned(
      words.slice(0, 2),
      [{ from: 0, to: 2, s: 0, e: 3.5 }],
      [
        [
          [0.1, 0.6],
          [0.5, 0.9],
        ],
      ],
    );
    expect(out[1]).toEqual(w("b", 0.6, 0.9));
  });
});

describe("alignWords without WhisperX", () => {
  it("keeps whisper's times and says how to set it up", async () => {
    const words = [{ w: " hi", s: 0, e: 0.4 }];
    const said: string[] = [];
    const out = await alignWords("/nowhere/a.wav", words, {
      python: "/nowhere/python",
      warn: (l) => said.push(l),
    });
    expect(out).toEqual(words);
    expect(said[0]).toMatch(/keeping whisper's times. Set up: uv venv/);
  });
});
