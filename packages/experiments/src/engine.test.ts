import { describe, expect, it } from "vitest";
import {
  type AlleleCounts,
  evaluateLocus,
  FITNESS,
  pBest,
  posteriors,
  SELECTION,
  stopReason,
  withFloor,
} from "./engine.js";
import { betaDraw, seeded } from "./rng.js";
import { parseSettings } from "./settings.js";

const counts = (exposures: number, interested: number, extra: Partial<AlleleCounts> = {}) => ({
  exposures,
  replies: interested,
  interested,
  booked: 0,
  opens: 0,
  tracked: 0,
  negatives: 0,
  ...extra,
});
const settings = parseSettings({});

describe("settings", () => {
  it("fills every default from {}", () => {
    expect(settings).toMatchObject({
      selection: "thompson",
      fitness: "interested",
      floor: 0.05,
      prior: 50,
      minSends: 300,
      window: 14,
      guards: { negativeRatio: 2 },
      autoApprove: false,
    });
    expect(() => parseSettings({ selection: "greedy" })).toThrow();
  });
});

describe("pBest", () => {
  it("splits evenly between equal posteriors and favors the stronger one", () => {
    const even = pBest([
      { a: 5, b: 95 },
      { a: 5, b: 95 },
    ]);
    expect(even[0]).toBeCloseTo(0.5, 3);
    const p = pBest([
      { a: 2, b: 298 },
      { a: 12, b: 288 },
    ]);
    expect(p[1]).toBeGreaterThan(0.99);
    expect((p[0] ?? 0) + (p[1] ?? 0)).toBeCloseTo(1, 9);
  });

  it("matches Monte Carlo on three close arms", () => {
    const post = [
      { a: 6, b: 294 },
      { a: 9, b: 291 },
      { a: 8, b: 292 },
    ];
    const rng = seeded("mc");
    const wins = [0, 0, 0];
    for (let i = 0; i < 40_000; i++) {
      const d = post.map(({ a, b }) => betaDraw(rng, a, b));
      const at = d.indexOf(Math.max(...d));
      wins[at] = (wins[at] ?? 0) + 1;
    }
    for (const [i, p] of pBest(post).entries()) expect(p).toBeCloseTo((wins[i] ?? 0) / 40_000, 2);
  });
});

describe("posteriors", () => {
  it("pools the prior at the locus mean", () => {
    const [a] = posteriors(
      [
        { successes: 0, trials: 0 },
        { successes: 10, trials: 498 },
      ],
      50,
    );
    expect((a?.a ?? 0) / ((a?.a ?? 0) + (a?.b ?? 0))).toBeCloseTo(11 / 500, 6);
  });
});

describe("fitness", () => {
  it("credits opens to tracked sends and lexicographic falls back to replies", () => {
    const c = [counts(100, 0, { replies: 3, opens: 20, tracked: 50 }), counts(100, 0)];
    expect(FITNESS.opens(c, settings.weights)[0]).toEqual({ successes: 20, trials: 50 });
    expect(FITNESS.lexicographic(c, settings.weights)[0]).toEqual({ successes: 3, trials: 100 });
    const w = FITNESS.weighted([counts(10, 1, { replies: 2, booked: 1 })], settings.weights)[0];
    expect(w?.successes).toBeCloseTo((2 + 2 + 4) / 7, 9);
  });
});

describe("selection", () => {
  const arms = [
    { successes: 2, trials: 300 },
    { successes: 12, trials: 300 },
  ];
  const post = posteriors(arms, 50);
  const input = { arms, posteriors: post, pBest: pBest(post) };
  it("each strategy favors the better arm except even", () => {
    const close = (got: number[], want: number[]) =>
      expect(got.map((v) => v.toFixed(9))).toEqual(want.map((v) => v.toFixed(9)));
    close(SELECTION.even(input), [0.5, 0.5]);
    close(SELECTION.epsilon(input), [0.05, 0.95]);
    expect(SELECTION.ucb1(input)).toEqual([0, 1]);
    expect(SELECTION.thompson(input)[1]).toBeGreaterThan(0.99);
  });
  it("keeps the floor", () => {
    const s = withFloor([0, 1, 0, 0], 0.05);
    expect(s.map((v) => v.toFixed(9))).toEqual([
      "0.050000000",
      "0.850000000",
      "0.050000000",
      "0.050000000",
    ]);
    expect(withFloor([1, 0], 0.6)).toEqual([0.5, 0.5]);
  });
});

describe("evaluateLocus", () => {
  const locus = (c: AlleleCounts[], over: Partial<Parameters<typeof evaluateLocus>[0]> = {}) =>
    evaluateLocus(
      {
        locus: "hook",
        alleles: c.map((_, i) => `a${i}`),
        counts: c,
        tried: c.length,
        history: [],
        ...over,
      },
      settings,
    );

  it("stays near even with little data", () => {
    const r = locus([counts(20, 1), counts(20, 0), counts(20, 0)]);
    expect(r.retire).toEqual([]);
    expect(r.settled).toBe(false);
    for (const s of Object.values(r.shares)) expect(s).toBeGreaterThan(0.15);
  });

  it("retires a clear loser and settles a clear winner", () => {
    const r = locus([counts(400, 1), counts(400, 20), counts(400, 2)]);
    expect(r.retire).toEqual([
      { allele: "a0", reason: "p_best" },
      { allele: "a2", reason: "p_best" },
    ]);
    expect(r.best).toBe("a1");
    expect(r.settled).toBe(true);
    expect(r.shares).toEqual({ a1: 1 });
    expect(stopReason([r])).toBe("settled");
  });

  it("settled keeps 90% on the winner", () => {
    const r = locus([counts(300, 8), counts(4000, 200)]);
    expect(r.retire).toEqual([]);
    expect(r.settled).toBe(true);
    expect(r.shares.a0).toBeCloseTo(0.1, 9);
    expect(r.shares.a1).toBe(0.9);
  });

  it("the guard retires a high-negative allele whatever its fitness", () => {
    const r = locus([
      counts(400, 12, { negatives: 30 }),
      counts(400, 10, { negatives: 2 }),
      counts(400, 10, { negatives: 2 }),
    ]);
    expect(r.retire).toEqual([{ allele: "a0", reason: "guard" }]);
    expect(Object.keys(r.shares)).toEqual(["a1", "a2"]);
  });

  it("never retires the last live allele", () => {
    const r = locus([counts(400, 0, { negatives: 40 })]);
    expect(r.retire).toEqual([]);
  });

  it("is stagnant when the best held for the window and spent at maxAlleles", () => {
    const c = [counts(100, 3), counts(100, 2)];
    expect(locus(c, { history: Array(13).fill("a0") }).stagnant).toBe(true);
    expect(locus(c, { history: [...Array(12).fill("a0"), "a1"] }).stagnant).toBe(false);
    const spent = locus(c, { tried: 12 });
    expect(spent.spent).toBe(true);
    expect(stopReason([spent])).toBe("budget");
    expect(stopReason([locus(c)])).toBeNull();
  });
});
