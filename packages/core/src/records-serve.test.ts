import { describe, expect, it } from "vitest";
import { statWindows } from "./records-serve.js";

const iso = (w: ReturnType<typeof statWindows>) => ({
  from: w.from.toISOString(),
  priorFrom: w.priorFrom.toISOString(),
  priorTo: w.priorTo.toISOString(),
  days: w.days.length,
});

describe("statWindows", () => {
  it("a week so far, against last week cut to the same elapsed time", () => {
    expect(iso(statWindows(7, "UTC", new Date("2026-03-10T15:00:00Z")))).toEqual({
      from: "2026-03-04T00:00:00.000Z",
      priorFrom: "2026-02-25T00:00:00.000Z",
      priorTo: "2026-03-03T15:00:00.000Z",
      days: 7,
    });
  });

  it("a month so far; the prior month is cut to its own length", () => {
    expect(iso(statWindows("month", "UTC", new Date("2026-03-10T15:00:00Z")))).toEqual({
      from: "2026-03-01T00:00:00.000Z",
      priorFrom: "2026-02-01T00:00:00.000Z",
      priorTo: "2026-02-10T15:00:00.000Z",
      days: 10,
    });
    // On the 31st, February ran out: the prior is all of it, never into March.
    expect(statWindows("month", "UTC", new Date("2026-03-31T12:00:00Z")).priorTo).toEqual(
      new Date("2026-03-01T00:00:00Z"),
    );
  });

  it("January looks back to December", () => {
    const w = statWindows("month", "UTC", new Date("2026-01-15T00:00:00Z"));
    expect(w.priorFrom).toEqual(new Date("2025-12-01T00:00:00Z"));
    expect(statWindows(7, "UTC", new Date("2026-01-03T09:00:00Z")).from).toEqual(
      new Date("2025-12-28T00:00:00Z"),
    );
  });

  it("days start at the zone's midnight, across a DST change", () => {
    // 2026-03-02 03:00 UTC is still Sunday the 1st in Chicago (CST, UTC-6).
    expect(iso(statWindows(1, "America/Chicago", new Date("2026-03-02T03:00:00Z")))).toEqual({
      from: "2026-03-01T06:00:00.000Z",
      priorFrom: "2026-02-28T06:00:00.000Z",
      priorTo: "2026-03-01T03:00:00.000Z",
      days: 1,
    });
    // Clocks went forward on the 8th: midnights move from 06:00 to 05:00 UTC.
    const days = statWindows(7, "America/Chicago", new Date("2026-03-10T12:00:00Z")).days;
    expect(days.slice(4).map((d) => d.toISOString())).toEqual([
      "2026-03-08T06:00:00.000Z",
      "2026-03-09T05:00:00.000Z",
      "2026-03-10T05:00:00.000Z",
    ]);
  });

  it("at midnight the period so far is empty, and so is the prior", () => {
    const w = statWindows(1, "UTC", new Date("2026-03-10T00:00:00Z"));
    expect(w.priorTo).toEqual(w.priorFrom);
  });
});
