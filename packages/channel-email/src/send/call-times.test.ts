import { describe, expect, it } from "vitest";
import { CALL_TIMES, fillCallTimes, pickTimes, sayTimes } from "./call-times.js";

const ET = "America/New_York";
const PT = "America/Los_Angeles";
// Monday 2026-10-05, 9am ET.
const NOW = new Date(Date.UTC(2026, 9, 5, 13));
const at = (day: number, hourUtc: number) => new Date(Date.UTC(2026, 9, day, hourUtc));

describe("pickTimes", () => {
  it("skips the next 20 hours, then takes a morning and a later day's afternoon", () => {
    const open = [at(5, 18), at(6, 14), at(6, 15), at(7, 14), at(7, 18)];
    expect(pickTimes(open, ET, NOW)).toEqual([at(6, 14), at(7, 18)]);
  });

  it("keeps to the lead's working day", () => {
    // 10am ET is 7am PT: too early for them.
    const open = [at(6, 14), at(6, 17), at(7, 21)];
    expect(pickTimes(open, PT, NOW)).toEqual([at(6, 17), at(7, 21)]);
  });

  it("offers one when only one day is open, none when nothing is", () => {
    expect(pickTimes([at(6, 14), at(6, 18)], ET, NOW)).toEqual([at(6, 14)]);
    expect(pickTimes([], ET, NOW)).toEqual([]);
  });

  it("never reaches past six days, so a weekday name is unambiguous", () => {
    expect(pickTimes([at(12, 14)], ET, NOW)).toEqual([]);
  });
});

describe("sayTimes", () => {
  it("says the times in the lead's clock", () => {
    expect(sayTimes([at(6, 14), at(7, 18)], ET)).toBe("Tuesday at 10am or Wednesday at 2pm ET");
    expect(sayTimes([at(6, 17)], PT)).toBe("Tuesday at 10am PT");
    expect(sayTimes([new Date(Date.UTC(2026, 9, 6, 14, 30))], ET)).toBe("Tuesday at 10:30am ET");
  });

  it("falls back to words when there is nothing to offer", () => {
    expect(sayTimes([], ET)).toBe("early next week");
  });
});

describe("fillCallTimes", () => {
  it("leaves a body without the token alone", () => {
    expect(fillCallTimes("hello", [at(6, 14)], ET, NOW)).toEqual({ body: "hello", offered: [] });
  });

  it("falls back when the calendar could not answer, and defaults to ET", () => {
    const body = `I'm free ${CALL_TIMES}.`;
    expect(fillCallTimes(body, null, ET, NOW).body).toBe("I'm free early next week.");
    expect(fillCallTimes(body, [at(6, 14), at(7, 18)], null, NOW)).toEqual({
      body: "I'm free Tuesday at 10am or Wednesday at 2pm ET.",
      offered: [at(6, 14), at(7, 18)],
    });
  });
});
