import { describe, expect, it } from "vitest";
import { formatWhatWorked, scoreOf, type WorkedRow } from "./metrics.js";
import { weekOf } from "./restate/metrics.js";

describe("metrics", () => {
  it("scores engagement per 100 views, 0 without views", () => {
    expect(scoreOf({ views: 200, reactions: 20, comments: 1, shares: 0 })).toBeCloseTo(10.5);
    expect(scoreOf({ views: 0, reactions: 3, comments: 0, shares: 0 })).toBe(0);
  });

  it("formats one line per post and an empty window", () => {
    const row: WorkedRow = {
      draftId: "d",
      platform: "x",
      ideaId: "i",
      text: "the   gate\nasks first",
      url: "https://x.test/1",
      publishedAt: new Date(),
      views: 50,
      reactions: 5,
      comments: 1,
      shares: 0,
      asOf: new Date(),
      score: 12,
      looks: 1,
    };
    expect(formatWhatWorked([row])).toEqual([
      "12.0/100 · x · 50 views · 5+1+0 · the gate asks first · https://x.test/1",
    ]);
    expect(formatWhatWorked([])).toEqual(["no published posts with metrics in the window"]);
  });

  it("names the week by its Monday", () => {
    expect(weekOf(new Date("2026-09-21T03:00:00Z"))).toBe("2026-09-21"); // Monday
    expect(weekOf(new Date("2026-09-27T23:00:00Z"))).toBe("2026-09-21"); // Sunday
    expect(weekOf(new Date("2026-09-28T00:00:00Z"))).toBe("2026-09-28");
  });
});
