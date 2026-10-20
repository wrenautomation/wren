import { describe, expect, it } from "vitest";
import { clipPath, clipTo } from "./geometry.js";

const box = { left: 100, top: 100, right: 300, bottom: 200 };

describe("clipTo", () => {
  it("cuts nothing when the box is fully inside", () => {
    expect(clipTo(box, [{ left: 0, top: 0, right: 1000, bottom: 1000 }])).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
  });
  it("cuts what a scroller hides", () => {
    expect(clipTo(box, [{ left: 0, top: 150, right: 250, bottom: 1000 }])).toEqual({
      left: 0,
      top: 50,
      right: 50,
      bottom: 0,
    });
  });
  it("is null when nothing is left", () => {
    expect(clipTo(box, [{ left: 0, top: 300, right: 1000, bottom: 400 }])).toBeNull();
  });
});

describe("clipPath", () => {
  it("none when nothing is cut", () => {
    expect(clipPath({ top: 0, right: 0, bottom: 0, left: 0 })).toBe("none");
  });
  it("hides all when null", () => {
    expect(clipPath(null)).toBe("inset(100%)");
  });
  it("insets the cut", () => {
    expect(clipPath({ top: 1, right: 2, bottom: 3, left: 4 })).toBe("inset(1px 2px 3px 4px)");
  });
});
