import { describe, expect, it } from "vitest";
import { CADENCE_GOALS } from "./catalog.js";
import { goalsSchema } from "./goals.js";

describe("plan goals", () => {
  it("the default plan reads as a saved one", () => {
    expect(goalsSchema.parse({ goals: CADENCE_GOALS }).goals).toHaveLength(CADENCE_GOALS.length);
  });
  it("one vertical clip feeds six goals", () => {
    expect(CADENCE_GOALS.filter((g) => g.piece === "vertical").map((g) => g.platform)).toEqual([
      "youtube",
      "instagram",
      "tiktok",
      "facebook",
      "linkedin",
      "x",
    ]);
  });
  it("refuses a range under its goal and a shared id", () => {
    const [g] = CADENCE_GOALS;
    expect(goalsSchema.safeParse({ goals: [{ ...g, upTo: 0 }] }).success).toBe(false);
    expect(goalsSchema.safeParse({ goals: [g, g] }).success).toBe(false);
  });
});
