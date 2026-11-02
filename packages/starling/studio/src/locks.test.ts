import { describe, expect, it } from "vitest";
import { brokenLocks, changedPaths, valueAt, withLocks } from "./locks.js";

const edit = {
  shorts: [
    { from: 1, to: 30, title: "a" },
    { from: 40, to: 70, title: "b" },
  ],
  crops: { vertical: { x: 0.5, y: 0.5 } },
  title: "t",
};

describe("locks", () => {
  it("reads a path, list items from 1", () => {
    expect(valueAt(edit, "shorts.2.title")).toBe("b");
    expect(valueAt(edit, "crops.vertical.x")).toBe(0.5);
    expect(valueAt(edit, "shorts.3")).toBeUndefined();
  });

  it("names what a change touched, one level in", () => {
    const after = {
      shorts: [edit.shorts[0], { ...edit.shorts[1], title: "c" }],
      crops: { vertical: { x: 0.4, y: 0.5 }, square: { x: 0.5, y: 0.5 } },
      title: "u",
    };
    expect(changedPaths(edit, after, ["shorts", "crops", "title"])).toEqual([
      "shorts.2",
      "crops.vertical",
      "crops.square",
      "title",
    ]);
    // A list that grew or shrank is locked whole.
    expect(changedPaths(edit, { shorts: [edit.shorts[0]] }, ["shorts"])).toEqual(["shorts"]);
  });

  it("keeps each lock once, the wider one winning", () => {
    expect(withLocks(["shorts.2"], ["shorts.2", "crops.vertical"])).toEqual([
      "shorts.2",
      "crops.vertical",
    ]);
    expect(withLocks(["shorts.2", "title"], ["shorts"])).toEqual(["title", "shorts"]);
    expect(withLocks(["shorts"], ["shorts.1"])).toEqual(["shorts"]);
  });

  it("refuses only a change that moves a locked part", () => {
    const keep2 = { shorts: [{ ...edit.shorts[0], title: "z" }, edit.shorts[1]] };
    expect(brokenLocks(["shorts.2"], { shorts: edit.shorts }, keep2)).toEqual([]);
    const move2 = { shorts: [edit.shorts[0], { ...edit.shorts[1], to: 60 }] };
    expect(brokenLocks(["shorts.2", "title"], { shorts: edit.shorts }, move2)).toEqual([
      "shorts.2",
    ]);
  });
});
