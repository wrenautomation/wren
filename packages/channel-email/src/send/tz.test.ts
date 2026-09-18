import { describe, expect, it } from "vitest";
import { canonicalZone, offsetMinutes, wallClock, zonedInstant } from "./tz.js";

const CHI = "America/Chicago";

describe("tz", () => {
  it("knows real zones and refuses typos", () => {
    expect(canonicalZone("America/Chicago")).toBe("America/Chicago");
    expect(canonicalZone("UTC")).toBe("UTC");
    expect(canonicalZone("America/Chicargo")).toBeNull();
    expect(canonicalZone("")).toBeNull();
  });
  it("reads a wall clock and an offset", () => {
    const at = new Date(Date.UTC(2026, 8, 8, 13, 5, 9));
    expect(wallClock(CHI, at)).toEqual({
      year: 2026,
      month: 9,
      day: 8,
      hour: 8,
      minute: 5,
      second: 9,
    });
    expect(offsetMinutes(CHI, at)).toBe(-300);
    expect(offsetMinutes(CHI, new Date(Date.UTC(2026, 0, 8, 13)))).toBe(-360);
  });
  it("round-trips a wall clock to the instant", () => {
    expect(zonedInstant(CHI, 2026, 9, 8, 8, 0)).toEqual(new Date(Date.UTC(2026, 8, 8, 13, 0)));
    expect(zonedInstant(CHI, 2026, 1, 8, 8, 0)).toEqual(new Date(Date.UTC(2026, 0, 8, 14, 0)));
  });
  it("an ambiguous wall time is its first occurrence", () => {
    // 2026-11-01 01:30 happens twice in Chicago; the CDT one comes first.
    expect(zonedInstant(CHI, 2026, 11, 1, 1, 30)).toEqual(new Date(Date.UTC(2026, 10, 1, 6, 30)));
  });
  it("a nonexistent wall time is read with the pre-transition offset", () => {
    // 2026-03-08 02:30 never happens in Chicago; CST (-6) reads it as 08:30 UTC.
    expect(zonedInstant(CHI, 2026, 3, 8, 2, 30)).toEqual(new Date(Date.UTC(2026, 2, 8, 8, 30)));
  });
});
