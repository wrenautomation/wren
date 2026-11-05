import { describe, expect, it } from "vitest";
import { fitPlackettLuce, rateSplit, tiersToChoices } from "./rank.js";
import { seeded } from "./rng.js";

describe("tiersToChoices", () => {
  it("each item beats itself + every lower tier", () => {
    const c = tiersToChoices([["a"], ["b", "c"], [], ["d"]]);
    expect(c).toEqual([
      { set: ["a", "b", "c", "d"], winner: "a", weight: 1 },
      { set: ["b", "d"], winner: "b", weight: 1 },
      { set: ["c", "d"], winner: "c", weight: 1 },
    ]);
  });
});

describe("fitPlackettLuce", () => {
  it("recovers the order of true strengths from best-of-4 picks", () => {
    const truth: Record<string, number> = { a: 8, b: 4, c: 2, d: 1, e: 0.5, f: 0.25 };
    const ids = Object.keys(truth);
    const rng = seeded(7);
    const choices = [];
    for (let i = 0; i < 600; i++) {
      const set = [...ids].sort(() => rng() - 0.5).slice(0, 4);
      const total = set.reduce((t, s) => t + (truth[s] ?? 0), 0);
      let r = rng() * total;
      const winner =
        set.find((s) => {
          r -= truth[s] ?? 0;
          return r <= 0;
        }) ?? set[3];
      choices.push({ set, winner: winner as string });
    }
    const fit = fitPlackettLuce(ids, choices);
    expect(fit.map((s) => s.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    const a = fit.find((s) => s.id === "a")?.strength ?? 0;
    const f = fit.find((s) => s.id === "f")?.strength ?? 1;
    expect(Math.log(a / f)).toBeGreaterThan(Math.log(32) * 0.7);
  });

  it("keeps unseen items finite at 1 and wide", () => {
    const fit = fitPlackettLuce(["x", "y", "z"], [{ set: ["x", "y"], winner: "x" }]);
    const z = fit.find((s) => s.id === "z");
    expect(z?.seen).toBe(0);
    expect(Number.isFinite(z?.strength)).toBe(true);
    expect(z?.se).toBeGreaterThan(fit.find((s) => s.id === "x")?.se ?? 0);
  });
});

describe("rateSplit", () => {
  it("says early under the minimum", () => {
    const r = rateSplit([
      { has: true, good: true },
      { has: false, good: false },
    ]);
    expect(r.diff).toBe(1);
    expect(r.early).toBe(true);
  });
});
