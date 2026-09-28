import { describe, expect, it } from "vitest";
import { formatStatusLines, type StatusReport, startOfWeekUtc, weekSlipped } from "./status.js";

const WEDNESDAY = new Date("2026-09-16T00:00:00Z");
const THURSDAY = new Date("2026-09-17T00:00:00Z");
const SUNDAY = new Date("2026-09-20T00:00:00Z");

describe("weekSlipped", () => {
  it("is false before Thursday even with nothing drafted", () =>
    expect(weekSlipped(WEDNESDAY, 0)).toBe(false));
  it("is true Thursday onward with nothing drafted", () => {
    expect(weekSlipped(THURSDAY, 0)).toBe(true);
    expect(weekSlipped(SUNDAY, 0)).toBe(true);
  });
  it("is false once anything was drafted", () => expect(weekSlipped(SUNDAY, 1)).toBe(false));
});

describe("startOfWeekUtc", () => {
  it("is Monday for every day of the week, Sunday included", () => {
    expect(startOfWeekUtc(SUNDAY).toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(startOfWeekUtc(WEDNESDAY).toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });
});

describe("formatStatusLines", () => {
  it("renders every field with statuses sorted", () => {
    const report: StatusReport = {
      draftsByStatus: { published: 2, draft: 1 },
      oldestDraftDays: 3,
      openIdeas: 4,
      draftedThisWeek: 0,
      tokensThisMonth: { calls: 5, input: 1000, output: 200 },
    };
    expect(formatStatusLines(report)).toEqual([
      "drafts draft      1",
      "drafts published  2",
      "oldest draft waiting: 3 day(s)",
      "open ideas: 4",
      "drafted this week: 0",
      "drafting this month: 5 calls, 1000 in, 200 out",
    ]);
  });
});
