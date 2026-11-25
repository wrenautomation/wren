import { describe, expect, it } from "vitest";
import { keptFrames } from "./live-page.js";

const ids = [1, 2, 3, 4, 5, 6];
const none = new Set<number>();

describe("keptFrames", () => {
  it("keeps a frame loaded after it scrolls off", () => {
    // 1 and 2 were seen, now 5 and 6 are on screen
    const kept = keptFrames({
      ids,
      near: new Set([5, 6]),
      seen: [5, 6, 2, 1],
      picked: [],
      held: none,
      keep: 4,
    });
    expect([...kept]).toEqual([5, 6, 2, 1]);
  });

  it("drops the least recently seen past the cap", () => {
    const kept = keptFrames({
      ids,
      near: new Set([5, 6]),
      seen: [5, 6, 3, 2, 1],
      picked: [],
      held: none,
      keep: 4,
    });
    expect([...kept]).toEqual([5, 6, 3, 2]);
  });

  it("puts on-screen frames ahead of kept ones", () => {
    const kept = keptFrames({
      ids,
      near: new Set([1, 2]),
      seen: [6, 5, 4, 3],
      picked: [],
      held: none,
      keep: 3,
    });
    expect([...kept]).toEqual([1, 2, 6]);
  });

  it("never loads a held frame and puts a hand-played one first", () => {
    const kept = keptFrames({
      ids,
      near: new Set([1, 2, 3]),
      seen: [1, 2, 3],
      picked: [6],
      held: new Set([2]),
      keep: 3,
    });
    expect([...kept]).toEqual([6, 1, 3]);
  });

  it("forgets frames no longer in the batch", () => {
    const kept = keptFrames({ ids: [1, 2], near: none, seen: [9, 2], picked: [9], held: none });
    expect([...kept]).toEqual([2]);
  });
});
