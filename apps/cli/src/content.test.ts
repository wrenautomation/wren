import { describe, expect, it } from "vitest";
import { daysOf } from "./content.js";

describe("planner slots weekdays", () => {
  it("reads ranges, single days and lists", () => {
    expect(daysOf("1-5")).toEqual([1, 2, 3, 4, 5]);
    expect(daysOf("2")).toEqual([2]);
    expect(daysOf("5,1,3")).toEqual([1, 3, 5]);
  });

  it("refuses days outside 1..7", () => {
    expect(() => daysOf("0")).toThrow(/not weekdays/);
    expect(() => daysOf("6-8")).toThrow(/not weekdays/);
    expect(() => daysOf("mon")).toThrow(/not weekdays/);
  });
});
