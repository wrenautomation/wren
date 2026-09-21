import { describe, expect, it } from "vitest";
import { nextSlot } from "./slots.js";

const ET = "America/New_York";

describe("nextSlot", () => {
  it("is today's slot when it is still ahead, tomorrow's when it passed", () => {
    // Tuesday 2026-09-22 07:00 ET = 11:00Z
    expect(nextSlot("linkedin", new Date("2026-09-22T11:00:00Z"), ET).toISOString()).toBe(
      "2026-09-22T12:30:00.000Z",
    );
    expect(nextSlot("linkedin", new Date("2026-09-22T12:30:00Z"), ET).toISOString()).toBe(
      "2026-09-23T12:30:00.000Z",
    );
  });

  it("skips the weekend for work platforms, not for video ones", () => {
    // Friday 2026-09-25 13:00 ET, past LinkedIn's slot → Monday
    const fri = new Date("2026-09-25T17:00:00Z");
    expect(nextSlot("linkedin", fri, ET).toISOString()).toBe("2026-09-28T12:30:00.000Z");
    expect(nextSlot("instagram", fri, ET).toISOString()).toBe("2026-09-25T22:00:00.000Z");
    expect(nextSlot("youtube", new Date("2026-09-26T20:00:00Z"), ET).toISOString()).toBe(
      "2026-09-27T19:00:00.000Z",
    );
  });

  it("follows the zone through DST", () => {
    // 2026-11-01 is the fall-back Sunday in the US; Monday's 08:30 ET is 13:30Z, not 12:30Z.
    expect(nextSlot("linkedin", new Date("2026-10-31T00:00:00Z"), ET).toISOString()).toBe(
      "2026-11-02T13:30:00.000Z",
    );
  });
});
