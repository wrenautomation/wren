import { describe, expect, it } from "vitest";
import { cutTimeline } from "./film-check.js";

describe("cutTimeline", () => {
  it("measures the edit as it plays after its cuts", () => {
    const e = {
      cuts: [
        { from: 10, to: 20, state: "cut" },
        { from: 40, to: 45, state: "cut" },
      ],
      tracks: { main: { durationS: 60 } },
    } as never;
    const t = cutTimeline(e);
    expect(Math.round(t.durationS)).toBe(45);
    expect(t.cuts.map(Math.round)).toEqual([10, 30]);
  });
});
