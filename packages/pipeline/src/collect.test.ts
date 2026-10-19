import { checkWorkflows } from "@wren/core/workflows";
import { describe, expect, it } from "vitest";
import { collectedDelta, MONEY_WORKFLOW } from "./collect.js";

describe("collectedDelta", () => {
  it("adds what was paid", () => {
    expect(collectedDelta({ change: "paid", amount_cents: 12_500 })).toBe(12_500);
  });
  it("takes off what was refunded", () => {
    expect(
      collectedDelta({ change: "refunded", amount_cents: 12_500, refunded_cents: 4_000 }),
    ).toBe(-4_000);
  });
  it("ignores every other change", () => {
    for (const change of ["failed", "invoiced", "late"])
      expect(collectedDelta({ change, amount_cents: 500, refunded_cents: 500 })).toBe(0);
  });
  it("ignores an amount that is not whole cents", () => {
    expect(collectedDelta({ change: "paid", amount_cents: "12.5" })).toBe(0);
    expect(collectedDelta({ change: "paid", amount_cents: -5 })).toBe(0);
    expect(collectedDelta({ change: "paid" })).toBe(0);
    expect(collectedDelta({ change: "paid", amount_cents: "700" })).toBe(700);
  });
});

describe("pipeline.money", () => {
  it("checks as a workflow", () => {
    expect(checkWorkflows([MONEY_WORKFLOW], [])).toEqual([]);
  });
});
