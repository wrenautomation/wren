import { describe, expect, it } from "vitest";
import {
  ASKED_WINDOW,
  DEFAULT_POLICY,
  fleetDay,
  inWindow,
  nextOpen,
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
    expect(policyFor("manual", DEFAULT_POLICY, "manual", "opt_in")).toEqual(asked);
    expect(policyFor("manual", DEFAULT_POLICY, "manual", "published")).toEqual(DEFAULT_POLICY);
    expect(policyFor("manual", DEFAULT_POLICY, "sequence", "opt_in")).toEqual(DEFAULT_POLICY);
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

describe("nextOpen", () => {
  const asked = policyFor("form", DEFAULT_POLICY);
  it("is now when the window is open on their clock", () => {
    // 09:30 IST.
    const at = new Date("2026-10-15T04:00:00Z");
    expect(nextOpen("Asia/Kolkata", at, asked)).toEqual(at);
  });
  it("clamps an IST night to 08:00 IST the next morning", () => {
    // 21:10 IST Thu = 15:40Z; next open 08:00 IST Fri = 02:30Z.
    const at = new Date("2026-10-15T15:40:00Z");
    expect(inWindow("Asia/Kolkata", at, asked)).toBe(false);
    expect(nextOpen("Asia/Kolkata", at, asked)?.toISOString()).toBe("2026-10-16T02:30:00.000Z");
  });
  it("waits past an early IST morning to 08:00 the same day", () => {
    // 06:00 IST = 00:30Z.
    expect(nextOpen("Asia/Kolkata", new Date("2026-10-16T00:30:00Z"), asked)?.toISOString()).toBe(
      "2026-10-16T02:30:00.000Z",
    );
  });
  it("cold texts skip the weekend: Saturday waits for Monday 10:00 on both coasts", () => {
    // Sat 2026-10-17 12:00 ET; Mon 10:00 PT = 17:00Z is the first minute both coasts are open.
    expect(nextOpen(null, new Date("2026-10-17T16:00:00Z"), P)?.toISOString()).toBe(
      "2026-10-19T17:00:00.000Z",
    );
  });
});
