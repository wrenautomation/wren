import { describe, expect, it } from "vitest";
import { draftsOverdue, formatStatusLines, type StatusReport } from "./status.js";

const WEDNESDAY = new Date("2026-09-16T00:00:00Z");
const THURSDAY = new Date("2026-09-17T00:00:00Z");
const SUNDAY = new Date("2026-09-20T00:00:00Z");

describe("draftsOverdue", () => {
  it("is false before Thursday even with no drafts", () =>
    expect(draftsOverdue(WEDNESDAY, 0)).toBe(false));
  it("is true Thursday onward with no drafts", () => {
    expect(draftsOverdue(THURSDAY, 0)).toBe(true);
    expect(draftsOverdue(SUNDAY, 0)).toBe(true);
  });
  it("is false whenever a draft exists", () => expect(draftsOverdue(SUNDAY, 1)).toBe(false));
});

describe("formatStatusLines", () => {
  it("renders every field, sorted statuses, never as never", () => {
    const report: StatusReport = {
      postsByStatus: { published: 2, draft: 1 },
      oldestDraftDays: 3,
      unusedNotes: 4,
      lastResearchRunAt: null,
      spendThisMonthUsd: 1.5,
    };
    expect(formatStatusLines(report)).toEqual([
      "posts draft      1",
      "posts published  2",
      "oldest draft: 3 day(s)",
      "unused notes: 4",
      "last research run: never",
      "spend this month: $1.50",
    ]);
  });
});
