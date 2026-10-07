import { describe, expect, it } from "vitest";
import { dayKey, daysOf, lanes, parseDay, placeIn, rangeOf, step } from "./grid.js";

const keys = (ds: Date[]) => ds.map(dayKey);
const TUE = parseDay("2026-10-06") as Date;

describe("calendar grid", () => {
  it("reads a day and refuses one that isn't", () => {
    expect(dayKey(TUE)).toBe("2026-10-06");
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("tomorrow")).toBeNull();
  });

  it("draws a week Monday to Sunday and a day alone", () => {
    expect(keys(daysOf("week", TUE))).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(keys(daysOf("day", TUE))).toEqual(["2026-10-06"]);
    const sunday = parseDay("2026-10-11") as Date;
    expect(dayKey(daysOf("week", sunday)[0] as Date)).toBe("2026-10-05");
  });

  it("draws a month in whole weeks", () => {
    const days = daysOf("month", TUE);
    expect(days.length % 7).toBe(0);
    expect(dayKey(days[0] as Date)).toBe("2026-09-28");
    expect(dayKey(days.at(-1) as Date)).toBe("2026-11-01");
  });

  it("asks from the first midnight to the one after the last day", () => {
    const { from, to } = rangeOf("week", TUE);
    expect(dayKey(from)).toBe("2026-10-05");
    expect(dayKey(to)).toBe("2026-10-12");
    expect(from.getHours()).toBe(0);
  });

  it("steps by the view", () => {
    expect(dayKey(step("day", TUE, 1))).toBe("2026-10-07");
    expect(dayKey(step("week", TUE, -1))).toBe("2026-09-29");
    expect(dayKey(step("month", TUE, 1))).toBe("2026-11-01");
    expect(dayKey(step("list", TUE, 1))).toBe("2026-11-05");
  });

  it("places a call in its day and clips one that runs past midnight", () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 6, h, m);
    expect(placeIn(TUE, { start: at(10), end: at(10, 30) })).toEqual({ top: 600, height: 30 });
    expect(placeIn(TUE, { start: at(23, 30), end: new Date(2026, 9, 7, 0, 30) })).toEqual({
      top: 1410,
      height: 30,
    });
    expect(placeIn(TUE, { start: new Date(2026, 9, 7, 9), end: new Date(2026, 9, 7, 10) })).toBe(
      null,
    );
  });

  it("puts overlapping calls side by side, and a later one back to full width", () => {
    const b = (id: string, h: number, m: number, len: number) => ({
      id,
      start: new Date(2026, 9, 6, h, m),
      end: new Date(2026, 9, 6, h, m + len),
    });
    const got = lanes([
      b("a", 10, 0, 30),
      b("b", 10, 15, 30),
      b("c", 10, 30, 30),
      b("d", 12, 0, 30),
    ]);
    expect(got.map((g) => [g.item.id, g.lane, g.of])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1],
    ]);
  });
});
