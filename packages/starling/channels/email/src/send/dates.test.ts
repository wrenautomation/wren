/** Business-day cadence math (D36): weekends never receive a step. */
import { describe, expect, it } from "vitest";
import { addBusinessDays, PlainDate } from "./dates.js";

const MONDAY = new PlainDate(2026, 9, 7);
const FRIDAY = new PlainDate(2026, 9, 11);
const SATURDAY = new PlainDate(2026, 9, 12);

describe("addBusinessDays", () => {
  it("zero days from a weekday is the same day", () => {
    expect(addBusinessDays(MONDAY, 0).equals(MONDAY)).toBe(true);
  });
  it("weekend start rolls forward to Monday", () => {
    expect(addBusinessDays(SATURDAY, 0).toString()).toBe("2026-09-14");
  });
  it("Friday plus one lands on Monday", () => {
    expect(addBusinessDays(FRIDAY, 1).toString()).toBe("2026-09-14");
  });
  it("Monday plus three is Thursday", () => {
    expect(addBusinessDays(MONDAY, 3).toString()).toBe("2026-09-10");
  });
  it("a seven-day gap spans the weekend", () => {
    expect(addBusinessDays(MONDAY, 7).toString()).toBe("2026-09-16");
  });
  it("five business days is a calendar week on the same weekday", () => {
    for (const start of [MONDAY, new PlainDate(2026, 9, 9), FRIDAY]) {
      expect(addBusinessDays(start, 5).equals(start.addDays(7))).toBe(true);
    }
  });
  it("a holiday is skipped like a weekend", () => {
    // Wed Nov 25 2026 plus one, with Thanksgiving and the day after off: Monday.
    const off = (d: PlainDate) => d.month === 11 && (d.day === 26 || d.day === 27);
    expect(addBusinessDays(new PlainDate(2026, 11, 25), 1, off).toString()).toBe("2026-11-30");
    expect(addBusinessDays(new PlainDate(2026, 11, 26), 0, off).toString()).toBe("2026-11-30");
  });
  it("negative days refused", () => {
    expect(() => addBusinessDays(MONDAY, -1)).toThrow("past");
  });
});

describe("PlainDate", () => {
  it("parses strict ISO and refuses the rest", () => {
    expect(PlainDate.fromIso("2026-09-14").toString()).toBe("2026-09-14");
    for (const bad of ["2026-9-14", "14/09/2026", "2026-02-30", "next monday"]) {
      expect(() => PlainDate.fromIso(bad)).toThrow();
    }
  });
  it("weekday is Monday-based", () => {
    expect(MONDAY.weekday()).toBe(0);
    expect(SATURDAY.weekday()).toBe(5);
  });
  it("arithmetic", () => {
    expect(MONDAY.daysUntil(FRIDAY)).toBe(4);
    expect(FRIDAY.addDays(-4).equals(MONDAY)).toBe(true);
    expect(PlainDate.utcDayOf(new Date(Date.UTC(2026, 8, 7, 23, 59))).equals(MONDAY)).toBe(true);
  });
});
