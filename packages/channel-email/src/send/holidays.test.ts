/** Holiday calendars: checked against published 2022, 2026 and 2027 dates. */
import { describe, expect, it } from "vitest";
import { PlainDate } from "./dates.js";
import { holidayOn, holidaysIn, parseHolidayCalendars } from "./holidays.js";

const days = (calendar: "us" | "ca" | "year_end", year: number) => [
  ...holidaysIn([calendar], year).keys(),
];
const US = new Set(["us"] as const);

describe("us", () => {
  it("2026: offices close these days", () => {
    expect(days("us", 2026).sort()).toEqual([
      "2026-01-01",
      "2026-05-25",
      "2026-07-03", // July 4 is a Saturday
      "2026-07-04",
      "2026-09-07",
      "2026-11-26",
      "2026-11-27",
      "2026-12-24",
      "2026-12-25",
    ]);
  });
  it("2027: Sunday July 4 moves to Monday, Saturday New Year 2028 to Dec 31", () => {
    const y = holidaysIn(["us"], 2027);
    expect(y.get("2027-07-05")).toBe("Independence Day (observed)");
    expect(y.get("2027-11-25")).toBe("Thanksgiving");
    expect(y.get("2027-12-31")).toBe("New Year's Day (observed)");
    expect(y.get("2027-12-24")).toBe("Christmas Eve"); // also Christmas observed
  });
  it("skips the federal holidays offices work through", () => {
    expect(holidayOn(US, new PlainDate(2027, 1, 18))).toBeNull(); // MLK Day
    expect(holidayOn(US, new PlainDate(2026, 10, 12))).toBeNull(); // Columbus Day
    expect(holidayOn(US, new PlainDate(2026, 11, 11))).toBeNull(); // Veterans Day
  });
});

describe("ca", () => {
  it("2026: statutory holidays with Easter and Victoria Day computed", () => {
    const y = holidaysIn(["ca"], 2026);
    expect(y.get("2026-04-03")).toBe("Good Friday");
    expect(y.get("2026-05-18")).toBe("Victoria Day"); // May 24 is a Sunday
    expect(y.get("2026-10-12")).toBe("Thanksgiving (Canada)");
    expect(y.get("2026-12-28")).toBe("Boxing Day (observed)"); // Boxing Day is a Saturday
  });
  it("2027: Victoria Day on May 24 itself; weekend Christmas and Boxing Day take Mon and Tue", () => {
    const y = holidaysIn(["ca"], 2027);
    expect(y.get("2027-03-26")).toBe("Good Friday");
    expect(y.get("2027-05-24")).toBe("Victoria Day");
    expect(y.has("2027-12-27")).toBe(true);
    expect(y.has("2027-12-28")).toBe(true);
  });
  it("2022: Sunday Christmas moves past Boxing Monday to Tuesday", () => {
    const y = holidaysIn(["ca"], 2022);
    expect(y.get("2022-12-26")).toBe("Boxing Day");
    expect(y.get("2022-12-27")).toBe("Christmas Day (observed)");
  });
});

describe("year_end", () => {
  it("is Dec 24 through Jan 1", () => {
    expect(days("year_end", 2026).sort()).toEqual([
      "2026-01-01",
      "2026-12-24",
      "2026-12-25",
      "2026-12-26",
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
    ]);
  });
});

describe("holidayOn", () => {
  it("names the day by the first calendar listed", () => {
    const both = new Set(["us", "year_end"] as const);
    expect(holidayOn(both, new PlainDate(2026, 12, 25))).toBe("Christmas Day");
    expect(holidayOn(both, new PlainDate(2026, 12, 29))).toBe("the year-end break");
  });
  it("no calendars, no holidays", () => {
    expect(holidayOn(new Set(), new PlainDate(2026, 12, 25))).toBeNull();
  });
});

describe("parseHolidayCalendars", () => {
  it("reads a comma list, or none", () => {
    expect([...parseHolidayCalendars(" us, CA ,year_end", "K")]).toEqual(["us", "ca", "year_end"]);
    expect(parseHolidayCalendars("none", "K").size).toBe(0);
    expect(() => parseHolidayCalendars("none,us", "K")).toThrow(/unknown holiday calendar 'none'/);
  });
  it("refuses a typo", () => {
    expect(() => parseHolidayCalendars("us,xmas", "WREN_SEND_HOLIDAYS")).toThrow(
      /unknown holiday calendar 'xmas' in WREN_SEND_HOLIDAYS/,
    );
  });
});
