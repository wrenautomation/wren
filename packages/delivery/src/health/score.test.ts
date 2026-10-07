import { describe, expect, it } from "vitest";
import {
  bandOf,
  combine,
  expectedBy,
  meanOf,
  moneyScore,
  ratingScore,
  resultsScore,
  shareScore,
  shownScore,
  staleOf,
  visitsScore,
  WEIGHTS,
} from "./score.js";

describe("health score", () => {
  it("weights the parts present, a missing part's weight going to the rest", () => {
    const all = combine({
      results: { score: 50 },
      engagement: { score: 100 },
      sentiment: { score: 75 },
      money: { score: 100 },
    });
    // (50×40 + 100×20 + 75×25 + 100×15) / 100
    expect(all).toEqual({
      score: 74,
      weights: { results: 40, engagement: 20, sentiment: 25, money: 15 },
    });
    const noResults = combine({
      results: { score: null },
      engagement: { score: 100 },
      sentiment: { score: 75 },
      money: { score: 100 },
    });
    expect(noResults.score).toBe(90);
    expect(noResults.weights).toEqual({ results: 0, engagement: 33, sentiment: 42, money: 25 });
    expect(
      combine({
        results: { score: null },
        engagement: { score: null },
        sentiment: { score: null },
        money: { score: null },
      }).score,
    ).toBeNull();
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("bands at 70 and 40", () => {
    expect([bandOf(70), bandOf(69), bandOf(40), bandOf(39), bandOf(null)]).toEqual([
      "healthy",
      "watch",
      "watch",
      "risk",
      "none",
    ]);
  });

  it("expects results on a straight line from the start day, and waits for one", () => {
    const t = { count: 20, fromDay: 14 };
    expect(expectedBy(t, 90, 10)).toBe(0);
    expect(expectedBy(t, 90, 52)).toBe(10);
    expect(expectedBy(t, 90, 120)).toBe(20);
    expect(resultsScore(0, 0.5)).toEqual({ score: null, why: "Too early to measure" });
    expect(resultsScore(6, 10)).toEqual({ score: 60, why: "6 of 10 expected by now" });
    expect(resultsScore(14, 10).score).toBe(100);
  });

  it("scores visits, shares, ratings and money", () => {
    expect([visitsScore(0), visitsScore(2), visitsScore(9)]).toEqual([0, 50, 100]);
    expect([shareScore(0, 0), shareScore(3, 1)]).toEqual([null, 75]);
    expect([1, 3, 5].map(ratingScore)).toEqual([0, 50, 100]);
    expect([null, 0, 3, 12, 45].map(moneyScore)).toEqual([100, 100, 60, 30, 0]);
    expect(meanOf([null, 40, 80])).toBe(60);
    expect(meanOf([null])).toBeNull();
  });

  it("marks a part stale past its limit, and shows the override over the model", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(staleOf("sentiment", "2026-10-08T12:00:00Z", now)).toBe(true);
    expect(staleOf("sentiment", "2026-10-10T12:00:00Z", now)).toBe(false);
    expect(staleOf("money", "2026-01-01T00:00:00Z", now)).toBe(false);
    expect(staleOf("results", null, now)).toBe(false);
    expect([shownScore(55, null), shownScore(55, 80)]).toEqual([55, 80]);
  });
});
