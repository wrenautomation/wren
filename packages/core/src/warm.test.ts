import { describe, expect, it } from "vitest";
import { COLD_EVERY_MS, warmEveryMs } from "./warm.js";

const NOW = new Date("2026-10-06T18:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

describe("warm cadence", () => {
  it("checks often right after a touch, then eases to cold", () => {
    expect(warmEveryMs(ago(1), NOW, 0.5)).toBe(2 * 60_000);
    expect(warmEveryMs(ago(30), NOW, 0.5)).toBe(5 * 60_000);
    expect(warmEveryMs(ago(120), NOW, 0.5)).toBe(15 * 60_000);
    expect(warmEveryMs(ago(600), NOW, 0.5)).toBe(COLD_EVERY_MS);
    expect(warmEveryMs(null, NOW, 0.5)).toBe(COLD_EVERY_MS);
  });
  it("jitters within ±20%", () => {
    expect(warmEveryMs(ago(1), NOW, 0)).toBe(96_000);
    expect(warmEveryMs(ago(1), NOW, 0.999)).toBeLessThan(144_000);
  });
});
