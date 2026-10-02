import { describe, expect, it } from "vitest";
import { CALL_TIMES, fillCallTimes, pickTimes, sayTimes, weekdaysAfter } from "./call-times.js";

const ET = "America/New_York";
const PT = "America/Los_Angeles";
// Monday 2026-10-05, 9am ET.
const NOW = new Date(Date.UTC(2026, 9, 5, 13));
const at = (day: number, hourUtc: number) => new Date(Date.UTC(2026, 9, day, hourUtc));

describe("pickTimes", () => {
  it("offers afternoons two and three weekdays after the send", () => {
    // Monday send: Wednesday and Thursday. Tuesday and mornings are skipped.
    const open = [at(6, 18), at(7, 14), at(7, 17), at(7, 18), at(8, 19)];
    expect(pickTimes(open, ET, NOW)).toEqual([at(7, 17), at(8, 19)]);
  });

  it("skips the weekend: a Friday send offers Tuesday and Wednesday", () => {
    const friday = new Date(Date.UTC(2026, 9, 2, 20));
    const open = [at(5, 17), at(6, 17), at(7, 18)];
    expect(pickTimes(open, ET, friday)).toEqual([at(6, 17), at(7, 18)]);
  });

  it("keeps to the lead's afternoon", () => {
    // 1pm ET is 10am PT: still morning for them.
    const open = [at(7, 17), at(7, 20), at(8, 21)];
    expect(pickTimes(open, PT, NOW)).toEqual([at(7, 20), at(8, 21)]);
  });

  it("offers one when only one day is open, none when nothing is", () => {
    expect(pickTimes([at(7, 17), at(7, 19)], ET, NOW)).toEqual([at(7, 17)]);
    expect(pickTimes([], ET, NOW)).toEqual([]);
  });

  it("never reaches past six days, so a weekday name is unambiguous", () => {
    expect(pickTimes([at(12, 17)], ET, NOW)).toEqual([]);
  });
});

describe("weekdaysAfter", () => {
  it("counts weekdays only", () => {
    expect(weekdaysAfter("2026-10-05", 2)).toBe("2026-10-07");
    expect(weekdaysAfter("2026-10-01", 2)).toBe("2026-10-05");
    expect(weekdaysAfter("2026-10-03", 2)).toBe("2026-10-06");
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
    expect(fillCallTimes(body, [at(7, 17), at(8, 18)], null, NOW)).toEqual({
      body: "I'm free Wednesday at 1pm or Thursday at 2pm ET.",
      offered: [at(7, 17), at(8, 18)],
    });
  });
});
