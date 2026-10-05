import { describe, expect, it } from "vitest";

Object.assign(globalThis, { location: new URL("https://app.example.test/") });
const { weeksOf } = await import("./chart.js");

const days = (values: (number | null)[]) =>
  values.map((value, i) => ({ at: `2026-01-${String(i + 1).padStart(2, "0")}`, value }));

describe("weeksOf", () => {
  it("buckets days into weeks, the last ending today; a short series fills the newest weeks", () => {
    expect(weeksOf(days([1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]), 2)).toEqual([7, 14]);
    expect(weeksOf(days([5, null, 1]), 2)).toEqual([0, 6]);
    expect(weeksOf(days([9, ...Array(14).fill(1)]), 2)).toEqual([7, 7]);
  });
});
