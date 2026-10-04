import { describe, expect, it } from "vitest";
import { simulate } from "./simulate.js";

describe("simulate", () => {
  const opts = {
    loci: 2,
    alleles: 4,
    rates: [0.01, 0.015, 0.02, 0.03],
    perDay: 20,
    days: 200,
    runs: 8,
    seed: "test",
  };
  it("thompson beats even on regret over fixed seeds, and repeats exactly", () => {
    const [thompson, even] = simulate({ ...opts, selections: ["thompson", "even"] });
    expect(thompson?.regret).toBeLessThan((even?.regret ?? 0) * 0.85);
    expect(thompson?.bestShare).toBeGreaterThan(even?.bestShare ?? 1);
    expect(simulate({ ...opts, runs: 2, selections: ["thompson"] })).toEqual(
      simulate({ ...opts, runs: 2, selections: ["thompson"] }),
    );
  });
  it("settles a clear winner and counts the days", () => {
    const [r] = simulate({
      ...opts,
      loci: 1,
      alleles: 2,
      rates: [0.01, 0.08],
      perDay: 50,
      days: 60,
      runs: 3,
      selections: ["thompson"],
      settings: { minSends: 100, mutation: "retire_only" },
    });
    expect(r?.settledRuns).toBe(3);
    expect(r?.wrongSettles).toBe(0);
    expect(r?.daysToSettle).toBeGreaterThan(1);
  });
});
