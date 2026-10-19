/** Today's Write list: platforms in order, the quota, met ones folded, the rest on Autopilot. */
import { describe, expect, it } from "vitest";
import type { Goal } from "./modules/marketing/plan.js";
import { met, wantOf, writeOf } from "./write.js";

let n = 0;
const goal = (platform: string, piece: string, more: Partial<Goal> = {}): Goal => ({
  id: `g${++n}`,
  platform,
  label: platform,
  name: platform,
  goal: 7,
  upTo: null,
  pace: "",
  how: "",
  piece,
  pieceName: piece,
  starts: "words",
  daily: 1,
  done: 0,
  today: 0,
  queued: 0,
  write: 3,
  ...more,
});

describe("writeOf", () => {
  const goals = [
    goal("x", "written", { daily: 4 }),
    goal("reddit", "written", { daily: null, goal: 2 }),
    goal("facebook", "written", { daily: 2 }),
    goal("youtube", "long", { daily: null, goal: 2, write: 1 }),
    goal("youtube", "vertical", { daily: 3 }),
    goal("instagram", "vertical", { daily: 3 }),
    goal("linkedin", "written", { daily: 1, today: 1 }),
    goal("tiktok", "vertical", { daily: 3 }),
    goal("threads", "written", { daily: 4 }),
    goal("newsletter", "newsletter", { daily: null, write: 0, goal: 3 }),
  ];

  it("orders YouTube long-form, LinkedIn, Reddit, Instagram, Facebook", () => {
    expect(writeOf(goals).lines.map((l) => l.id)).toEqual([
      "youtube",
      "linkedin",
      "reddit",
      "instagram",
      "facebook",
    ]);
  });

  it("counts YouTube long-form on its line, its shorts and posts on Autopilot", () => {
    const { lines, autopilot } = writeOf(goals);
    expect(lines[0]).toMatchObject({ label: "YouTube long-form", want: 1, have: 0 });
    expect(autopilot?.folded).toEqual(["X", "TikTok", "Threads", "YouTube shorts and posts"]);
    // 4 + 3 + 4 + 3. The blog has nothing to write, so it adds none.
    expect(autopilot?.want).toBe(14);
  });

  it("marks a met quota, and caps what a goal made at its own quota", () => {
    expect(
      writeOf(goals)
        .lines.filter(met)
        .map((l) => l.id),
    ).toEqual(["linkedin"]);
    const one = writeOf([
      goal("x", "written", { daily: 1, today: 5 }),
      goal("tiktok", "vertical", { daily: 3, today: 0 }),
    ]);
    expect(one.autopilot).toMatchObject({ want: 4, have: 1 });
    expect(one.autopilot && met(one.autopilot)).toBe(false);
  });

  it("asks one a day of a weekly goal that still lacks, none once the week is full", () => {
    expect(wantOf(goal("reddit", "written", { daily: null, write: 1 }))).toBe(1);
    expect(wantOf(goal("reddit", "written", { daily: null, write: 0, today: 0 }))).toBe(0);
    expect(wantOf(goal("reddit", "written", { daily: null, write: 0, today: 1 }))).toBe(1);
  });

  it("leaves out a goal the plan does not count", () => {
    const out = writeOf([goal("linkedin", "written", { done: null, today: null, write: null })]);
    expect(out).toEqual({ lines: [], autopilot: null });
  });

  it("points a line at the goal that lacks most", () => {
    const { lines } = writeOf([
      goal("linkedin", "written", { daily: 1, today: 1 }),
      goal("linkedin", "vertical", { daily: 3, today: 0 }),
    ]);
    expect(lines[0]?.next.piece).toBe("vertical");
  });
});
