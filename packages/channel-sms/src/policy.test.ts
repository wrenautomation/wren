import { describe, expect, it } from "vitest";
import {
  ASKED_WINDOW,
  DEFAULT_POLICY,
  fleetDay,
  inWindow,
  numberCapOn,
  parseClock,
  policyFor,
} from "./policy.js";

describe("policyFor", () => {
  it("callers and answers get the asked window; cold texts keep the cold one", () => {
    const asked = { ...DEFAULT_POLICY, ...ASKED_WINDOW };
    expect(policyFor("call", DEFAULT_POLICY)).toEqual(asked);
    expect(policyFor("tel_link", DEFAULT_POLICY, "review")).toEqual(asked);
    expect(policyFor("tel_link", DEFAULT_POLICY, "sequence")).toEqual(DEFAULT_POLICY);
  });
});

const P = DEFAULT_POLICY; // 10:00–17:00, Mon–Fri

describe("inWindow", () => {
  // Tue 2026-09-29 15:00Z = 11:00 ET = 08:00 PT.
  const tueMorning = new Date("2026-09-29T15:00:00Z");
  it("judges a known zone on its own clock", () => {
    expect(inWindow("America/New_York", tueMorning, P)).toBe(true);
    expect(inWindow("America/Los_Angeles", tueMorning, P)).toBe(false);
  });
  it("needs both ET and PT open when the zone is unknown", () => {
    expect(inWindow(null, tueMorning, P)).toBe(false);
    expect(inWindow(null, new Date("2026-09-29T18:00:00Z"), P)).toBe(true); // 14:00 ET, 11:00 PT
    expect(inWindow("Not/AZone", new Date("2026-09-29T18:00:00Z"), P)).toBe(true);
  });
  it("skips weekends at the lead", () => {
    expect(inWindow("America/New_York", new Date("2026-10-03T15:00:00Z"), P)).toBe(false);
  });
  it("clamps any setting to 8:00–20:00", () => {
    const wide = {
      ...P,
      windowStartMinute: 0,
      windowEndMinute: 24 * 60,
      days: [1, 2, 3, 4, 5, 6, 7],
    };
    expect(inWindow("America/New_York", new Date("2026-09-29T11:30:00Z"), wide)).toBe(false); // 07:30
    expect(inWindow("America/New_York", new Date("2026-09-30T00:30:00Z"), wide)).toBe(false); // 20:30
    expect(inWindow("America/New_York", new Date("2026-09-29T12:00:00Z"), wide)).toBe(true); // 08:00
  });
});

describe("caps", () => {
  it("ramps a number up to its cap", () => {
    expect(numberCapOn("2026-09-28", "2026-09-28", P)).toBe(20);
    expect(numberCapOn("2026-09-28", "2026-09-30", P)).toBe(40);
    expect(numberCapOn("2026-09-28", "2027-09-28", P)).toBe(200);
  });
  it("counts fleet days in Eastern time", () => {
    expect(fleetDay(new Date("2026-09-30T03:00:00Z"))).toBe("2026-09-29");
  });
  it("parses clock times", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(() => parseClock("9h")).toThrow();
  });
});
