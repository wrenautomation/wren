import { describe, expect, it } from "vitest";
import { clipPath, clipTo } from "./geometry.js";

const box = { left: 100, top: 100, right: 300, bottom: 200 };

describe("clipTo", () => {
  it("cuts nothing inside, what a scroller hides, and is null when nothing is left", () => {
    expect(clipTo(box, [{ left: 0, top: 0, right: 1000, bottom: 1000 }])).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
    expect(clipTo(box, [{ left: 0, top: 150, right: 250, bottom: 1000 }])).toEqual({
      left: 0,
      top: 50,
      right: 50,
      bottom: 0,
    });
    expect(clipTo(box, [{ left: 0, top: 300, right: 1000, bottom: 400 }])).toBeNull();
  });
});

describe("clipPath", () => {
  it("none when nothing is cut, hides all when null, else insets the cut", () => {
    expect(clipPath({ top: 0, right: 0, bottom: 0, left: 0 })).toBe("none");
    expect(clipPath(null)).toBe("inset(100%)");
    expect(clipPath({ top: 1, right: 2, bottom: 3, left: 4 })).toBe("inset(1px 2px 3px 4px)");
  });
});
