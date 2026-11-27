import { describe, expect, it } from "vitest";
import { kindHold } from "./checks.js";
import { durationMs } from "./job-pauses.js";

describe("durationMs", () => {
  it("reads minutes, hours and days", () => {
    expect(["30m", "2h", "1d"].map(durationMs)).toEqual([1_800_000, 7_200_000, 86_400_000]);
  });
  it("refuses anything else", () => {
    expect(() => durationMs("2 weeks")).toThrow(/30m, 2h or 1d/);
  });
});

describe("kindHold", () => {
  it("maps a unit to the hold that covers its kind", () => {
    expect(kindHold("replies acct-1")).toBe("replies *");
    expect(kindHold("posts linkedin")).toBe("posts *");
  });
});
