import { describe, expect, it } from "vitest";
import { graceArea, inPolygon } from "./safe-triangle.js";

const flyout = { left: 250, right: 450, top: 100, bottom: 400 } as DOMRectReadOnly;

describe("the invisible triangle", () => {
  // The pointer left its row at (200, 120), heading right for a flyout from y 100 to 400.
  const area = graceArea({ x: 200, y: 120 }, flyout);

  it.each([
    ["the exit point", { x: 200, y: 120 }, true],
    ["the diagonal down to the flyout", { x: 225, y: 200 }, true],
    ["inside the flyout", { x: 300, y: 380 }, true],
    ["straight down the sidebar", { x: 200, y: 200 }, false],
    ["back left", { x: 150, y: 120 }, false],
    ["above the flyout", { x: 300, y: 90 }, false],
  ] as const)("%s", (_, p, want) => {
    expect(inPolygon(p, area)).toBe(want);
  });
});
