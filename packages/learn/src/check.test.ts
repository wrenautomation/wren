import { describe, expect, it } from "vitest";
import { checkPiece } from "./check.js";
import { type KindStandard, rulesOf, type SopCall } from "./standard.js";

const call = (id: number, path: string, value: string, c: SopCall["call"]): SopCall => ({
  id,
  title: `Piece ${id}`,
  creator: null,
  path,
  label: path === "hook_style" ? "Hook style" : path === "cta" ? "Call to action" : "Music",
  value,
  call: c,
  comment: null,
  at: new Date("2026-10-25T00:00:00Z"),
});

const standard: KindStandard = {
  kind: "post",
  n: 9,
  trusted: 9,
  numbers: [
    { label: "Characters", n: 9, median: 600, p25: 400, p75: 900 },
    { label: "Lines", n: 9, median: 8, p25: 5, p75: 12 },
    { label: "Hashtags", n: 9, median: 0, p25: 0, p75: 1 },
  ],
  shares: [
    {
      label: "Shape",
      n: 9,
      of: [
        ["list", 6],
        ["story", 3],
      ],
    },
  ],
};

describe("a piece against the SOP", () => {
  it("rolls his calls into rules and holds ours to the standard and the rules", () => {
    const { patterns, own } = rulesOf([
      call(1, "hook_style", "demo-first", "keep"),
      call(2, "hook_style", "demo-first", "keep"),
      call(3, "hook_style", "demo-first", "keep"),
      call(4, "cta", "comment-word: comment GUIDE", "drop"),
      call(5, "facts/music", "true", "keep"),
      call(6, "hook", "Watch this (it opens on the product)", "tune"),
    ]);
    expect(patterns.map((p) => [p.label, p.value, p.rule])).toEqual([
      ["Call to action", "comment-word", false],
      ["Hook style", "demo-first", true],
      ["Music", "yes", false],
    ]);
    expect(own.map((c) => c.id)).toEqual([6]);

    const c = checkPiece("post", standard, patterns, {
      chars: 1200,
      lines: 7,
      hashtags: null,
      hookStyle: "demo-first",
      ctaKind: "comment-word",
      shape: "list",
    });
    expect(c.n).toBe(9);
    expect(c.numbers.map((x) => [x.label, x.ours, x.where])).toEqual([
      ["Characters", 1200, "above"],
      ["Lines", 7, "inside"],
      ["Hashtags", null, null],
    ]);
    expect(c.shares).toEqual([
      {
        label: "Shape",
        n: 9,
        of: [
          ["list", 6],
          ["story", 3],
        ],
        ours: "list",
      },
    ]);
    expect(c.patterns.map((p) => [p.label, p.verdict])).toEqual([
      ["Call to action", "breaks"],
      ["Hook style", "meets"],
    ]);
  });

  it("gives empty lists with no standard and no calls", () => {
    expect(checkPiece("film", null, [], { cuts: 12 })).toEqual({
      kind: "film",
      n: 0,
      numbers: [],
      shares: [],
      patterns: [],
    });
  });
});
