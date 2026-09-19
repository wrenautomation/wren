import { describe, expect, it } from "vitest";
import { formatRate, wilsonInterval } from "./stats.js";

describe("wilsonInterval", () => {
  it("is [0, 1] with no trials and pinned at the edges", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
    expect(wilsonInterval(0, 10).low).toBe(0);
    expect(wilsonInterval(10, 10).high).toBe(1);
  });

  it("matches the Python implementation on a known case", () => {
    // emailsgen.stats.wilson_interval(3, 62) → (0.0166, 0.1329)
    const { low, high } = wilsonInterval(3, 62);
    expect(low).toBeCloseTo(0.0166, 3);
    expect(high).toBeCloseTo(0.1329, 3);
  });

  it("brackets k/n and stays inside [0, 1] at small n", () => {
    const { low, high } = wilsonInterval(1, 3);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThanOrEqual(1 / 3);
    expect(high).toBeGreaterThanOrEqual(1 / 3);
    expect(high).toBeLessThan(1);
  });

  it("refuses impossible counts", () => {
    expect(() => wilsonInterval(5, 3)).toThrow(/5 successes/);
    expect(() => wilsonInterval(-1, 3)).toThrow(/non-negative/);
    expect(() => wilsonInterval(1.5, 3)).toThrow(/integers/);
  });
});

describe("formatRate", () => {
  it("prints rate, interval and n", () => {
    expect(formatRate(3, 62)).toBe("4.8% [1.7%–13.3%] n=62");
    expect(formatRate(0, 0)).toBe("n=0");
  });
});
