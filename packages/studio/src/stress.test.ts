import { describe, expect, it } from "vitest";
import type { Word } from "./schema.js";
import {
  checkStress,
  parseStress,
  proposeStress,
  remapStress,
  spaceStress,
  stressPrompt,
  wordAt,
} from "./stress.js";

/** One word every 0.4 s, 0.3 s long; a "." ends a phrase. */
function said(text: string): Word[] {
  return text.split(" ").map((w, i) => ({ w, s: i * 0.4, e: i * 0.4 + 0.3 }));
}
/** `n` words, a sentence every 5 (a phrase each 2 s). */
const talk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    w: i % 5 === 4 ? `w${i}.` : `w${i}`,
    s: i * 0.4,
    e: i * 0.4 + 0.3,
  }));

describe("stress parser", () => {
  const words = said("we made 40 calls. and booked 12 meetings. in a week.");

  it("reads indexes checked against their words", () => {
    expect(parseStress('{"stress":[{"i":2,"w":"40"},{"i":6,"w":"12"}]}', words)).toEqual([2, 6]);
  });

  it("moves a miscounted index to the word it names, drops one it can't find", () => {
    expect(parseStress('{"stress":[{"i":3,"w":"40"},{"i":6,"w":"revenue"}]}', words)).toEqual([2]);
  });

  it("takes a bare list, prose around the JSON, and drops junk and repeats", () => {
    expect(parseStress('Sure: [2, 2, "x", 99, 6] done', words)).toEqual([2, 6]);
    expect(parseStress("no json here", words)).toEqual([]);
    expect(parseStress("{broken", words)).toEqual([]);
  });

  it("keeps only picks in its chunk", () => {
    expect(parseStress("[1, 5, 9]", words, 4, 8)).toEqual([5]);
  });

  it("numbers each word and puts a phrase a line", () => {
    const p = stressPrompt(words, 0, 5);
    expect(p).toContain("[0]we [1]made [2]40 [3]calls.\n[4]and");
    expect(p).toContain('{"stress"');
  });
});

describe("spacing rule", () => {
  const words = talk(400); // 160 s

  it("one big word a beat, never two on screen, 0.6 s apart", () => {
    // 2 and 3 share a beat; 6 starts 1.6 s after 2 ends + 1.2 hold: under the gap.
    expect(spaceStress(words, [2, 3, 6, 12])).toEqual([2, 12]);
  });

  it("keeps the earliest-listed when two clash, and answers in time order", () => {
    expect(spaceStress(words, [12, 2, 11])).toEqual([2, 12]);
  });

  it("caps model picks a minute", () => {
    const every = Array.from({ length: 30 }, (_, k) => k * 10); // one each 4 s
    const kept = spaceStress(words, every, { perMinute: 3 });
    const minute0 = kept.filter((i) => (words[i] as Word).s < 60);
    expect(minute0).toHaveLength(3);
  });

  it("checks a set list: bad indexes first, then clashes", () => {
    expect(checkStress(words, [2, 12])).toEqual([]);
    expect(checkStress(words, [2, 999])[0]).toMatch(/no word 999/);
    expect(checkStress(words, [2, 2])[0]).toMatch(/twice/);
    expect(checkStress(words, [2, 3])[0]).toMatch(/same beat/);
    expect(checkStress(words, [2, 6])[0]).toMatch(/under 0.6s/);
  });
});

describe("picks by time and across a transcript fix", () => {
  const words = said("one two three four");

  it("finds the word said at a time, else the nearest within a second", () => {
    expect(wordAt(words, 0.45)).toBe(1);
    expect(wordAt(words, 0.72)).toBe(1);
    expect(() => wordAt(words, 9)).toThrow(/no word near/);
  });

  it("moves picks to the word covering their middle when words merge", () => {
    const merged = [words[0], { w: "two-three", s: 0.4, e: 1.1 }, words[3]] as Word[];
    expect(remapStress(words, merged, [2, 3])).toEqual([1, 2]);
    expect(remapStress(words, words, [3])).toEqual([3]);
  });
});

describe("proposeStress", () => {
  it("asks per chunk, spaces the picks, answers the edit's own indexes", async () => {
    const words = talk(20);
    // The edit's words 100.., all kept: the model sees 0..19.
    const cut = words.map((w, j) => ({ i: 100 + j, w }));
    const model = { complete: async () => ({ text: "[2, 3, 12]" }) };
    const r = await proposeStress(model, cut);
    expect(r).toEqual({ stress: [102, 112], asked: 1, offered: 3 });
  });
});
