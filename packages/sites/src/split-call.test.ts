import { describe, expect, it } from "vitest";
import { MIN_VISITS, posteriorsOf, splitCall } from "./split-call.js";

describe("splitCall", () => {
  it("waits for MIN_VISITS on every arm and says how many more", () => {
    const call = splitCall([
      { label: "A", visits: 40, goals: 4 },
      { label: "B", visits: 80, goals: 1 },
    ]);
    expect(call.kind).toBe("too_early");
    expect(call.more).toBe(MIN_VISITS - 40 + MIN_VISITS - 80);
    expect(call.words).toBe("Too early: 80 more visits");
    expect(call.leader).toBeNull();
  });

  it("says one visit, not one visits", () => {
    expect(
      splitCall([
        { label: "A", visits: 99, goals: 0 },
        { label: "B", visits: 100, goals: 0 },
      ]).words,
    ).toBe("Too early: 1 more visit");
  });

  it("makes no call with no goals at all", () => {
    const call = splitCall([
      { label: "A", visits: 200, goals: 0 },
      { label: "B", visits: 200, goals: 0 },
    ]);
    expect(call.kind).toBe("no_goals");
    expect(call.sure[0]).toBeCloseTo(0.5, 2);
  });

  it("calls a clear leader settled past 95%", () => {
    const call = splitCall([
      { label: "A", visits: 1000, goals: 20 },
      { label: "B", visits: 1000, goals: 45 },
    ]);
    expect(call.kind).toBe("settled");
    expect(call.leader).toBe("B");
    expect(call.words).toMatch(/^B wins, 9\d% sure$/);
  });

  it("calls a small lead ahead, not won", () => {
    const call = splitCall([
      { label: "A", visits: 300, goals: 12 },
      { label: "B", visits: 300, goals: 17 },
    ]);
    expect(call.kind).toBe("leading");
    expect(call.words).toMatch(/^B is ahead, \d\d% sure$/);
    // Two equal-size arms, 12 vs 17 of 300: P(B best) near 0.83 (normal approximation).
    expect(call.sure[1]).toBeGreaterThan(0.75);
    expect(call.sure[1]).toBeLessThan(0.9);
    expect((call.sure[0] ?? 0) + (call.sure[1] ?? 0)).toBeCloseTo(1, 3);
  });

  it("is symmetric: equal counts are 50/50", () => {
    const call = splitCall([
      { label: "A", visits: 500, goals: 25 },
      { label: "B", visits: 500, goals: 25 },
    ]);
    expect(call.sure[0]).toBeCloseTo(0.5, 2);
  });

  it("handles three arms and never says 100%", () => {
    const call = splitCall([
      { label: "A", visits: 5000, goals: 10 },
      { label: "B", visits: 5000, goals: 400 },
      { label: "C", visits: 5000, goals: 50 },
    ]);
    expect(call.leader).toBe("B");
    expect(call.words).toBe("B wins, 99% sure");
  });

  it("uses a flat prior: Beta(1 + s, 1 + n - s), goals capped at visits", () => {
    expect(
      posteriorsOf([
        { label: "A", visits: 10, goals: 3 },
        { label: "B", visits: 2, goals: 5 },
      ]),
    ).toEqual([
      { a: 4, b: 8 },
      { a: 3, b: 1 },
    ]);
  });
});
