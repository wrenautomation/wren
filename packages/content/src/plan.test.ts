import { describe, expect, it } from "vitest";
import { formatPlan, shortfallOf, tomorrowOf } from "./plan.js";
import { nextRunAt } from "./restate/planner.js";

const ET = "America/New_York";

describe("daily plan", () => {
  it("tomorrow is the next calendar day on the zone's clock", () => {
    // 2026-09-26 23:30 ET = 09-27 03:30Z: tomorrow is still the 27th in ET.
    const t = tomorrowOf(new Date("2026-09-27T03:30:00Z"), ET);
    expect(t).toEqual({
      day: "2026-09-27",
      from: new Date("2026-09-27T04:00:00Z"),
      to: new Date("2026-09-28T04:00:00Z"),
    });
  });

  it("runs at the hour today if ahead, else tomorrow", () => {
    expect(nextRunAt(new Date("2026-09-26T15:00:00Z"), ET, 17).toISOString()).toBe(
      "2026-09-26T21:00:00.000Z",
    );
    expect(nextRunAt(new Date("2026-09-26T21:00:00Z"), ET, 17).toISOString()).toBe(
      "2026-09-27T21:00:00.000Z",
    );
  });

  it("says the shortfall", () => {
    const plan = {
      day: "2026-09-28",
      platforms: [
        { platform: "linkedin" as const, slots: 1, filled: 0, waiting: 2 },
        { platform: "reddit" as const, slots: 1, filled: 1, waiting: 0 },
      ],
      openIdeas: 3,
    };
    expect(shortfallOf(plan)).toBe(1);
    expect(formatPlan(plan)).toEqual([
      "linkedin: 0 of 1 slots filled, 2 drafts wait for review",
      "reddit: 1 of 1 slots filled",
      "3 ideas not drafted yet",
    ]);
  });
});
