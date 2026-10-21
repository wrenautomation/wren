import { describe, expect, it } from "vitest";
import { hoursSince, lateOf, promiseHours } from "./promise.js";

const NOW = new Date("2026-10-21T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 36e5).toISOString();

describe("promiseHours", () => {
  it("reads minutes, hours and days", () => {
    expect(promiseHours("30m")).toBe(0.5);
    expect(promiseHours("4h")).toBe(4);
    expect(promiseHours("2d")).toBe(48);
  });
  it("answers null for anything else", () => {
    for (const bad of ["", "soon", "4", "h", "4 h", "1.5h", "-2h"])
      expect(promiseHours(bad)).toBeNull();
  });
});

describe("lateOf", () => {
  it("is late only past the promise", () => {
    expect(lateOf(hoursAgo(25), "24h", NOW)).toBe(true);
    expect(lateOf(hoursAgo(23), "24h", NOW)).toBe(false);
  });
  it("is never late with no time or no promise", () => {
    expect(lateOf(null, "24h", NOW)).toBe(false);
    expect(lateOf("not a time", "24h", NOW)).toBe(false);
    expect(lateOf(hoursAgo(900), null, NOW)).toBe(false);
    expect(lateOf(hoursAgo(900), "soon", NOW)).toBe(false);
  });
  it("counts a time in the future as no wait", () => {
    expect(hoursSince(hoursAgo(-5), NOW)).toBe(0);
  });
});
