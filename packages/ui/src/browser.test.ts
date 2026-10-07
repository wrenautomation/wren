import { lineDiff } from "@wren/core/line-diff";
import { describe, expect, it } from "vitest";
import { folderTree } from "./browser.js";
import { pairsOf } from "./diff.js";

describe("folderTree", () => {
  it("nests paths, adds counts up to each parent, and sorts by name", () => {
    const tree = folderTree([
      { path: "b/two", count: 2 },
      { path: "a", count: 1 },
      { path: "b/one/deep", count: 3 },
      { path: "", count: 9 },
    ]);
    expect(tree.map((n) => [n.name, n.count])).toEqual([
      ["a", 1],
      ["b", 5],
    ]);
    expect(tree[1]?.children.map((n) => [n.path, n.count])).toEqual([
      ["b/one", 3],
      ["b/two", 2],
    ]);
  });
});

describe("pairsOf", () => {
  it("lines a changed run up side by side and pads the shorter side", () => {
    const pairs = pairsOf(lineDiff("same\nold\nend", "same\nnew\nmore\nend"));
    expect(pairs.map((p) => [p.left?.text ?? null, p.right?.text ?? null])).toEqual([
      ["same", "same"],
      ["old", "new"],
      [null, "more"],
      ["end", "end"],
    ]);
  });
});
