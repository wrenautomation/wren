import { describe, expect, it } from "vitest";
import { rampedCap, rampFor } from "./ramp.js";

describe("rampedCap", () => {
  it("starts low and climbs to the cap", () => {
    expect(rampFor(10)).toEqual({ start: 3, step: 2, everyDays: 2 });
    expect([0, 1, 2, 4, 6, 8, 30].map((d) => rampedCap(10, d))).toEqual([3, 3, 5, 7, 9, 10, 10]);
  });
  it("holds a zero cap and a negative day", () => {
    expect(rampedCap(0, 9)).toBe(0);
    expect(rampedCap(15, -3)).toBe(5);
  });
});
