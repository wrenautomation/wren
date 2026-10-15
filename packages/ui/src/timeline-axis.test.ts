import { describe, expect, it } from "vitest";
import {
  anchorOf,
  barOf,
  countsOf,
  dayFrom,
  dayKey,
  dayWhere,
  earlierOf,
  monthsOf,
  rangeOf,
  stepOf,
  stretchesOf,
  topOf,
  weeksOf,
  zoomOf,
} from "./timeline-axis.js";

const d = (s: string) => dayFrom(s) as Date;
const keys = (days: Date[]) => days.map(dayKey);
// Wednesday.
const TODAY = d("2026-10-14");

describe("the axis's range", () => {
  it("two weeks of days, ending with the anchor", () => {
    const r = rangeOf(TODAY, "day");
    expect(r).toHaveLength(14);
    expect([dayKey(r[0] as Date), dayKey(r.at(-1) as Date)]).toEqual(["2026-10-01", "2026-10-14"]);
  });

  it("week and month zooms start on a Monday and stay inside 92 days", () => {
    const w = rangeOf(TODAY, "week");
    expect(dayKey(w[0] as Date)).toBe("2026-07-27");
    expect((w[0] as Date).getDay()).toBe(1);
    expect(w.length).toBeLessThanOrEqual(84);
    const m = rangeOf(TODAY, "month");
    expect((m[0] as Date).getDay()).toBe(1);
    expect(m.length).toBeLessThanOrEqual(91);
    expect(dayKey(m.at(-1) as Date)).toBe("2026-10-14");
  });

  it("reads zoom and anchor from the address, never past today", () => {
    const p = new URLSearchParams("zoom=month&day=2026-03-02");
    expect(zoomOf(p)).toBe("month");
    expect(dayKey(anchorOf(p, TODAY))).toBe("2026-03-02");
    expect(zoomOf(new URLSearchParams("zoom=year"))).toBe("day");
    expect(dayKey(anchorOf(new URLSearchParams("day=2027-01-01"), TODAY))).toBe("2026-10-14");
    expect(dayKey(anchorOf(new URLSearchParams("day=2026-02-30"), TODAY))).toBe("2026-10-14");
  });

  it("steps a day, a week or a month, and stops at today", () => {
    expect(dayKey(stepOf(d("2026-10-10"), "day", 1, TODAY) as Date)).toBe("2026-10-11");
    expect(dayKey(stepOf(d("2026-10-10"), "week", 1, TODAY) as Date)).toBe("2026-10-14");
    expect(dayKey(stepOf(d("2026-10-10"), "month", -1, TODAY) as Date)).toBe("2026-09-10");
    expect(stepOf(TODAY, "day", 1, TODAY)).toBeNull();
    expect(dayKey(earlierOf(rangeOf(TODAY, "day")) as Date)).toBe("2026-09-30");
  });

  it("crosses a DST change a whole day at a time", () => {
    const r = rangeOf(d("2026-11-03"), "day");
    expect(new Set(keys(r)).size).toBe(14);
    expect(keys(r)).toContain("2026-11-01");
  });
});

describe("bucketing", () => {
  const days = rangeOf(d("2026-10-14"), "week");
  const series = [
    { at: d("2026-10-12").toISOString(), value: 5, by: { email_sent: 4, form: 1 } },
    { at: d("2026-10-14").toISOString(), value: 2, by: { email_sent: 2 } },
    { at: d("2026-10-05").toISOString(), value: 1, by: { booking: 1 } },
  ];
  const counts = countsOf(days, series);

  it("puts the server's series on local days, 0 where it has none", () => {
    expect(counts).toHaveLength(days.length);
    expect(counts.find((c) => c.day === "2026-10-12")).toEqual({
      day: "2026-10-12",
      n: 5,
      by: { email_sent: 4, form: 1 },
    });
    expect(counts.find((c) => c.day === "2026-10-13")).toEqual({ day: "2026-10-13", n: 0, by: {} });
  });

  it("sums days into weeks from Monday, and weeks into months", () => {
    const weeks = weeksOf(counts);
    expect(weeks).toHaveLength(12);
    const last = weeks.at(-1);
    expect([last?.week, last?.last, last?.n, last?.by]).toEqual([
      "2026-10-12",
      "2026-10-14",
      7,
      { email_sent: 6, form: 1 },
    ]);
    expect(weeks.at(-2)?.n).toBe(1);
    const months = monthsOf(weeks);
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(months.reduce((n, m) => n + m.weeks.length, 0)).toBe(12);
  });

  it("folds runs of empty days, newest first, keeping the days asked for", () => {
    const two = countsOf(rangeOf(d("2026-10-14"), "day"), series);
    const s = stretchesOf(two, new Set(["2026-10-14", "2026-10-02"]));
    expect(s.slice(0, 4)).toEqual([
      { day: two[13] },
      { quiet: { from: "2026-10-13", to: "2026-10-13", days: 1 } },
      { day: two[11] },
      { quiet: { from: "2026-10-06", to: "2026-10-11", days: 6 } },
    ]);
    expect(s.filter((x) => "day" in x).map((x) => ("day" in x ? x.day.day : ""))).toEqual([
      "2026-10-14",
      "2026-10-12",
      "2026-10-05",
      "2026-10-02",
    ]);
  });

  it("names the commonest states first and sums the rest", () => {
    expect(topOf({ a: 1, b: 9, c: 3, d: 2, e: 2, f: 0 }, 3)).toEqual({
      top: [
        ["b", 9],
        ["c", 3],
        ["d", 2],
      ],
      rest: 3,
    });
  });
});

describe("paging a day", () => {
  it("asks for one local day, midnight to its last millisecond", () => {
    const w = dayWhere("2026-10-12");
    expect(w?.gte).toBe(d("2026-10-12").toISOString());
    expect(new Date(w?.lte as string).getTime()).toBe(d("2026-10-13").getTime() - 1);
    expect(dayWhere("nope")).toBeNull();
  });

  it("draws a bar by square root, never invisible when it has lines", () => {
    expect(barOf(0, 100)).toBe(0);
    expect(barOf(100, 100)).toBe(1);
    expect(barOf(25, 100)).toBe(0.5);
    expect(barOf(1, 1_000_000)).toBe(0.08);
  });
});
