import { describe, expect, it } from "vitest";
import { formatPlan, freeSlots, shortfallOf, tomorrowOf } from "./plan.js";
import { nextRunAt, plannerTitle, slotsOf } from "./restate/planner.js";
import { DEFAULT_SLOTS } from "./slots.js";

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

  it("a slot is open until a draft holds it; an off-slot draft still takes one", () => {
    const a = new Date("2026-10-07T12:30:00Z");
    const b = new Date("2026-10-07T16:00:00Z");
    expect(freeSlots([a, b], [])).toEqual([a, b]);
    expect(freeSlots([a, b], [a])).toEqual([b]);
    expect(freeSlots([a, b], [new Date("2026-10-07T14:00:00Z")])).toEqual([a]);
    expect(freeSlots([a], [a, b])).toEqual([]);
  });

  it("settings replace a platform's slots and drop a malformed one", () => {
    const s = slotsOf({
      linkedin: [
        { hour: 8, minute: 30 },
        { hour: 25, minute: 0 },
      ],
    });
    expect(s.linkedin).toEqual([{ hour: 8, minute: 30 }]);
    expect(s.reddit).toEqual(DEFAULT_SLOTS.reddit);
  });

  it("the ping says what it drafted, else the shortfall", () => {
    const plan = {
      day: "2026-10-07",
      platforms: [{ platform: "linkedin" as const, slots: 2, filled: 0, waiting: 1 }],
      openIdeas: 0,
    };
    const d = (platform: "linkedin" | "reddit") => ({
      platform,
      draftId: "d",
      slot: "",
      source: "cli",
    });
    expect(plannerTitle(plan, [d("linkedin"), d("reddit")])).toBe(
      "content 2026-10-07: drafted 2 for tomorrow: LinkedIn, Reddit",
    );
    expect(plannerTitle(plan, [])).toBe("content 2026-10-07: 1 empty slots");
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
    expect(shortfallOf(plan)).toBe(0);
    expect(shortfallOf({ ...plan, platforms: [{ ...plan.platforms[1]!, filled: 0 }] })).toBe(1);
    expect(formatPlan(plan)).toEqual([
      "linkedin: 0 of 1 slots filled, 2 drafts wait for review",
      "reddit: 1 of 1 slots filled",
      "3 ideas not drafted yet",
    ]);
  });
});
