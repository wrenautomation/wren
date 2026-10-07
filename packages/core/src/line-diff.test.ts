import { describe, expect, it } from "vitest";
import { changed, lineDiff, unified } from "./line-diff.js";

const ops = (a: string, b: string) => lineDiff(a, b).map((l) => `${l.op}${l.text}`);

describe("lineDiff", () => {
  it("keeps common lines and puts removals before additions in a changed run", () => {
    expect(ops("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
    expect(ops("a\nc", "a\nb\nc")).toEqual([" a", "+b", " c"]);
    expect(ops("", "x")).toEqual(["+x"]);
    expect(ops("x", "")).toEqual(["-x"]);
    expect(changed(lineDiff("same", "same"))).toBe(false);
  });

  it("numbers lines on each side", () => {
    const d = lineDiff("a\nb", "z\na\nb");
    expect(d.map((l) => [l.a, l.b])).toEqual([
      [null, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("prints a unified diff with context and hunk headers", () => {
    const a = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join("\n");
    const b = a.replace("l5", "L5");
    expect(unified(lineDiff(a, b), ["a", "b"], 1)).toBe(
      ["--- a", "+++ b", "@@ -4,3 +4,3 @@", " l4", "-l5", "+L5", " l6"].join("\n"),
    );
    expect(unified(lineDiff(a, a), ["a", "b"])).toBe("");
  });
});
