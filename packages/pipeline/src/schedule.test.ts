import type { Terms } from "@wren/offers";
import { describe, expect, it } from "vitest";
import { scheduleOf } from "./schedule.js";

const terms = (over: Partial<Terms> = {}): Terms => ({
  currency: "USD",
  setupCents: 0,
  monthlyCents: null,
  perUnitCents: null,
  unit: null,
  capCents: null,
  days: null,
  payDays: 7,
  ...over,
});

describe("scheduleOf", () => {
  it("bills setup on signing", () => {
    expect(scheduleOf(terms({ setupCents: 10_000 }), "2027-01-10")).toEqual([
      { kind: "setup", on: "2027-01-10", cents: 10_000, currency: "USD" },
    ]);
  });

  it("splits setup in installments that add up", () => {
    const lines = scheduleOf(
      terms({ setupCents: 10_000, installments: { count: 3, everyDays: 30 } }),
      "2027-01-10",
    );
    expect(lines.map((l) => [l.on, l.kind === "setup" ? l.cents : 0])).toEqual([
      ["2027-01-10", 3334],
      ["2027-02-09", 3333],
      ["2027-03-11", 3333],
    ]);
    expect(lines[1]).toMatchObject({ part: { n: 2, of: 3 } });
  });

  it("bills monthly for the length of the deal", () => {
    const lines = scheduleOf(terms({ monthlyCents: 5_000, days: 90 }), "2027-01-01");
    expect(lines.map((l) => l.on)).toEqual(["2027-01-01", "2027-02-01", "2027-03-01"]);
  });

  it("keeps a month-end bill on the last day of a short month", () => {
    const lines = scheduleOf(terms({ monthlyCents: 5_000 }), "2027-01-31", "2027-03-31");
    expect(lines.map((l) => l.on)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("runs open-ended monthly lines for a year, or to `until`", () => {
    expect(scheduleOf(terms({ monthlyCents: 5_000 }), "2027-01-01")).toHaveLength(12);
    const cut = scheduleOf(terms({ monthlyCents: 5_000 }), "2027-01-01", "2027-03-01");
    expect(cut.map((l) => l.on)).toEqual(["2027-01-01", "2027-02-01", "2027-03-01"]);
  });

  it("notes a per-unit fee with its cap, undated", () => {
    expect(
      scheduleOf(
        terms({ perUnitCents: 2_500, unit: "meeting booked", capCents: 20_000 }),
        "2027-01-01",
      ),
    ).toEqual([
      {
        kind: "unit",
        on: null,
        centsEach: 2_500,
        unit: "meeting booked",
        capCents: 20_000,
        currency: "USD",
      },
    ]);
  });

  it("shows a share with no amount and its floor", () => {
    expect(scheduleOf(terms({ shareBps: 1000, floorCents: 3_000 }), "2027-01-01")).toEqual([
      {
        kind: "share",
        on: null,
        bps: 1000,
        basis: "on reported revenue",
        floorCents: 3_000,
        currency: "USD",
      },
    ]);
  });

  it("delays the first bill by the trial", () => {
    const lines = scheduleOf(
      terms({ setupCents: 1_000, monthlyCents: 500, days: 60, trialDays: 14 }),
      "2027-01-01",
    );
    expect(lines.map((l) => [l.kind, l.on])).toEqual([
      ["setup", "2027-01-15"],
      ["monthly", "2027-01-15"],
      ["monthly", "2027-02-15"],
    ]);
  });

  it("puts dated lines first, then undated", () => {
    const lines = scheduleOf(
      terms({ setupCents: 100, perUnitCents: 10, shareBps: 500 }),
      "2027-01-01",
    );
    expect(lines.map((l) => l.kind)).toEqual(["setup", "unit", "share"]);
  });
});
