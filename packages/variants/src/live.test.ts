import { describe, expect, it } from "vitest";
import { wilson } from "./live.js";

describe("wilson", () => {
  it("brackets the rate and stays in 0..1", () => {
    const [lo, hi] = wilson(5, 100);
    expect(lo).toBeLessThan(0.05);
    expect(hi).toBeGreaterThan(0.05);
    expect(wilson(0, 10)[0]).toBe(0);
    expect(wilson(10, 10)[1]).toBe(1);
  });

  it("is wide at small n, narrow at large n", () => {
    const w = ([lo, hi]: [number, number]) => hi - lo;
    expect(w(wilson(1, 10))).toBeGreaterThan(w(wilson(100, 1000)));
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});
