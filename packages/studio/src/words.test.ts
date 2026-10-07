import { describe, expect, it } from "vitest";
import type { Word } from "./schema.js";
import { fixWordAt, fixWords } from "./words.js";

const ws = (...xs: string[]): Word[] => xs.map((w, i) => ({ w, s: i, e: i + 0.8 }));

describe("words --fix", () => {
  it("rewrites every match, case and punctuation kept, times untouched", () => {
    const before = ws("Ren", "is", "here.", "ren,", "again");
    const r = fixWords(before, "ren", "wren");
    expect(r.n).toBe(2);
    expect(r.words.map((w) => w.w)).toEqual(["Wren", "is", "here.", "wren,", "again"]);
    expect(r.words.map((w) => [w.s, w.e])).toEqual(before.map((w) => [w.s, w.e]));
  });

  it("keeps a name's own capitals and an original that shouts", () => {
    expect(fixWords(ws("ren", "rocks"), "ren", "Wren").words[0]?.w).toBe("Wren");
    expect(fixWords(ws("REN"), "ren", "wren").words[0]?.w).toBe("WREN");
  });

  it("joins a run into one word over its span when the counts differ", () => {
    const r = fixWords(ws("we", "are", "Drug", "fooding."), "drug fooding", "dogfooding");
    expect(r.words).toEqual([
      { w: "we", s: 0, e: 0.8 },
      { w: "are", s: 1, e: 1.8 },
      { w: "Dogfooding.", s: 2, e: 3.8 },
    ]);
  });

  it("says when nothing matched", () => {
    expect(fixWords(ws("a", "b"), "c", "d").n).toBe(0);
    expect(() => fixWords(ws("a"), " ", "d")).toThrow();
  });

  it("--at rewrites the one word said then, or the nearest within a second", () => {
    const before = ws("hello", "ren,", "bye");
    expect(fixWordAt(before, 1.2, "Wren").words.map((w) => w.w)).toEqual(["hello", "Wren,", "bye"]);
    // Between words (1.8 to 2): the nearest.
    expect(fixWordAt(before, 1.9, "Wren").words[1]?.w).toBe("Wren,");
    expect(fixWordAt(before, 1.2, "Wren!").words[1]?.w).toBe("Wren!");
    expect(() => fixWordAt(before, 9, "x")).toThrow(/no word near/);
  });
});
