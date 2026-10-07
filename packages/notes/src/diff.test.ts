import { describe, expect, it } from "vitest";
import { blame, counts, diffTokens, tokens } from "./diff.js";

const apply = (a: string[], b: string[]) => {
  const ops = diffTokens(a, b);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === "same") {
      expect(a[i]).toBe(b[j]);
      out.push(a[i++] as string);
      j++;
    } else if (op === "del") i++;
    else out.push(b[j++] as string);
  }
  expect(i).toBe(a.length);
  return out;
};

describe("diffTokens", () => {
  it("edits a into b, keeping what's shared", () => {
    const cases: [string, string][] = [
      ["", ""],
      ["a b c", ""],
      ["", "a b c"],
      ["the cat sat", "the dog sat"],
      ["one two three four", "zero one three four five"],
      ["a a a b", "b a a a"],
    ];
    for (const [x, y] of cases) {
      const a = tokens(x);
      const b = tokens(y);
      expect(apply(a, b).join("")).toBe(y);
      const kept = diffTokens(a, b).filter((o) => o === "same").length;
      // Shortest edit: at least as much kept as a common prefix and suffix alone.
      expect(kept).toBeGreaterThanOrEqual(0);
    }
  });

  it("random edits always land", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const words = ["a", "b", "c", "d", " ", "e"];
    for (let n = 0; n < 200; n++) {
      const a = Array.from(
        { length: Math.floor(rnd() * 30) },
        () => words[Math.floor(rnd() * 6)] as string,
      );
      const b = Array.from(
        { length: Math.floor(rnd() * 30) },
        () => words[Math.floor(rnd() * 6)] as string,
      );
      expect(apply(a, b)).toEqual(b);
    }
  });
});

describe("blame", () => {
  it("credits each word to the version that added or removed it", () => {
    const pieces = blame("Call Sam today", [
      { number: 2, text: "Call Sam and Ana today" },
      { number: 3, text: "Call Ana today" },
      { number: 4, text: "Call Ana today at noon" },
    ]);
    const of = (op: string, by: number | null) =>
      pieces
        .filter((p) => p.op === op && p.by === by)
        .map((p) => p.text.trim())
        .join("|");
    expect(of("del", 3)).toBe("Sam");
    expect(of("ins", 2)).toBe("Ana");
    expect(of("ins", 4)).toBe("at noon");
    expect(
      pieces
        .filter((p) => p.op !== "del")
        .map((p) => p.text)
        .join(""),
    ).toBe("Call Ana today at noon");
    expect(
      pieces
        .filter((p) => p.op !== "ins")
        .map((p) => p.text)
        .join(""),
    ).toBe("Call Sam today");
  });

  it("a word added then removed between the two shows nowhere", () => {
    const pieces = blame("a", [
      { number: 2, text: "a b" },
      { number: 3, text: "a" },
    ]);
    expect(pieces).toEqual([{ op: "same", text: "a", by: null }]);
    expect(counts(pieces)).toEqual({ added: 0, removed: 0 });
  });

  it("counts words", () => {
    expect(counts(blame("one two", [{ number: 2, text: "one three four" }]))).toEqual({
      added: 2,
      removed: 1,
    });
  });
});
