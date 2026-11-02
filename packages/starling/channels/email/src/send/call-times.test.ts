import { describe, expect, it } from "vitest";
import {
  CALL_TIMES,
  fillCallTimes,
  firstOfferDay,
  pickTimes,
  sayTimes,
  weekdaysAfter,
} from "./call-times.js";

const ET = "America/New_York";
const PT = "America/Los_Angeles";
// Monday 2026-10-05, 9am ET.
const NOW = new Date(Date.UTC(2026, 9, 5, 13));
const at = (day: number, hourUtc: number) => new Date(Date.UTC(2026, 9, day, hourUtc));

describe("pickTimes", () => {
  it("offers 10am to 5pm two and three weekdays after the send", () => {
    // Monday send: Wednesday and Thursday. Tuesday and 9am are skipped.
    const open = [at(6, 18), at(7, 13), at(7, 17), at(7, 18), at(8, 19)];
    expect(pickTimes(open, ET, NOW)).toEqual([at(7, 17), at(8, 19)]);
  });

  it("one weekday when the count crosses a weekend: a Friday send offers Monday and Tuesday", () => {
    const friday = new Date(Date.UTC(2026, 9, 2, 20));
    const open = [at(3, 17), at(5, 17), at(6, 18), at(7, 18)];
    expect(pickTimes(open, ET, friday)).toEqual([at(5, 17), at(6, 18)]);
  });

  it("keeps to the lead's hours", () => {
    // 12pm ET is 9am PT: too early for them; 1pm ET is 10am PT.
    const open = [at(7, 16), at(7, 17), at(8, 21)];
    expect(pickTimes(open, PT, NOW)).toEqual([at(7, 17), at(8, 21)]);
  });

  it("offers one when only one day is open, none when nothing is", () => {
    expect(pickTimes([at(7, 17), at(7, 19)], ET, NOW)).toEqual([at(7, 17)]);
    expect(pickTimes([], ET, NOW)).toEqual([]);
  });

  it("never reaches past six days, so a weekday name is unambiguous", () => {
    expect(pickTimes([at(12, 17)], ET, NOW)).toEqual([]);
  });
});

describe("firstOfferDay", () => {
  it("is two weekdays out, one when that would cross a weekend", () => {
    expect(firstOfferDay("2026-10-05")).toBe("2026-10-07"); // Mon → Wed
    expect(firstOfferDay("2026-10-07")).toBe("2026-10-09"); // Wed → Fri
    expect(firstOfferDay("2026-10-08")).toBe("2026-10-09"); // Thu → Fri
    expect(firstOfferDay("2026-10-09")).toBe("2026-10-12"); // Fri → Mon
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
