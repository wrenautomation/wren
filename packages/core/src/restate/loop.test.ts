import { describe, expect, it } from "vitest";
import { retryDelayMs } from "./loop.js";

describe("retryDelayMs", () => {
  it("starts at 15s, doubles per failure in a row, stops at the cap", () => {
    const cap = 8 * 60_000;
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => retryDelayMs(n, cap))).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 480_000, 480_000,
    ]);
    expect(retryDelayMs(3, 3_000)).toBe(3_000);
  });
});
