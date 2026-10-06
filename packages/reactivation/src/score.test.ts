import { describe, expect, it } from "vitest";
import { POINTS, type ScoreInput, scoreContact, startedAgo, startedIn } from "./score.js";

const today = new Date("2026-09-29T12:00:00Z");
const base: ScoreInput = { firm: "Acme", where: null, hiring: null, placed: null, contacted: null };
const where = (kind: "still_there" | "job_change" | "left", value = {}) => ({ id: 5, kind, value });

describe("scoreContact", () => {
  it("orders the cases: hiring there > moved > still there > nothing new", () => {
    const hiringThere = scoreContact(
      { ...base, where: where("still_there"), hiring: { id: 9, count: 3 } },
      today,
    );
    const moved = scoreContact({ ...base, where: where("job_change", { to: "Beta" }) }, today);
    const still = scoreContact({ ...base, where: where("still_there") }, today);
    const unknown = scoreContact(base, today);
    expect(hiringThere.score).toBe(POINTS.stillThere + POINTS.hiringThere);
    expect(moved.score).toBe(POINTS.moved);
    expect(still.score).toBe(POINTS.stillThere);
    expect(unknown.score).toBe(POINTS.unknown);
    expect(hiringThere.score).toBeGreaterThan(moved.score);
    expect(moved.score).toBeGreaterThan(still.score);
    expect(still.score).toBeGreaterThan(unknown.score);
  });

  it("a stay under its owner's name says so, and scores as a stay", () => {
    const parent = where("still_there", { company: "Paramount", relation: "parent" });
    const s = scoreContact({ ...base, firm: "CBS", where: parent }, today);
    expect(s.reasons[0]?.reason).toBe("Still at CBS, part of Paramount, nothing new");
    expect(s.score).toBe(POINTS.stillThere);
    const same = where("still_there", { company: "The Walt Disney Company", relation: "same" });
    expect(scoreContact({ ...base, firm: "Disney", where: same }, today).reasons[0]?.reason).toBe(
      "Still at Disney, nothing new",
    );
  });

  it("someone who left scores nothing, whatever else is true", () => {
    const s = scoreContact(
      {
        ...base,
        where: where("left", { from: "Acme Staffing" }),
        hiring: { id: 9, count: 3 },
        placed: { on: "2026-09-01", crmId: 1 },
      },
      today,
    );
    expect(s).toEqual({
      score: 0,
      reasons: [{ reason: "Left Acme Staffing, new firm unknown", points: 0, cites: ["f5"] }],
      nextStep: "none",
    });
  });

  it("hiring counts less when we don't know they're still there", () => {
    const s = scoreContact({ ...base, hiring: { id: 9, count: 2 } }, today);
    expect(s.score).toBe(POINTS.unknown + POINTS.hiringUnknown);
    expect(s.reasons[0]).toEqual({ reason: "Acme has 2 open roles", points: 30, cites: ["f9"] });
    expect(s.nextStep).toBe("reach_out");
  });

  it("a mover's hiring is their old firm's, so it doesn't count", () => {
    const s = scoreContact(
      {
        ...base,
        where: where("job_change", { to: "Beta", title: "VP Ops" }),
        hiring: { id: 9, count: 2 },
      },
      today,
    );
    expect(s.reasons).toEqual([{ reason: "Moved to Beta, now VP Ops", points: 70, cites: ["f5"] }]);
    expect(s.nextStep).toBe("reach_out");
  });

  it("recency bonuses only inside their windows, cited to the CRM row", () => {
    const inside = scoreContact(
      {
        ...base,
        placed: { on: "2024-09-29", crmId: 3 },
        contacted: { on: "2025-09-29", crmId: 4 },
      },
      today,
    );
    expect(inside.score).toBe(POINTS.unknown + POINTS.placedRecently + POINTS.contactedRecently);
    // Ties keep their order: nothing new (10) before last contacted (10).
    expect(inside.reasons.map((r) => r.cites)).toEqual([["c3"], [], ["c4"]]);
    const outside = scoreContact(
      {
        ...base,
        placed: { on: "2024-09-28", crmId: 3 },
        contacted: { on: "2025-09-28", crmId: 4 },
      },
      today,
    );
    expect(outside.score).toBe(POINTS.unknown);
  });

  it("reasons are biggest first and add up to the score", () => {
    const s = scoreContact(
      {
        ...base,
        where: where("still_there"),
        hiring: { id: 9, count: 1 },
        contacted: { on: "2026-08-01", crmId: 2 },
      },
      today,
    );
    expect(s.reasons.map((r) => r.points)).toEqual([60, 40, 10]);
    expect(s.reasons.reduce((n, r) => n + r.points, 0)).toBe(s.score);
  });

  it("a move with no firm named is a leaving: nothing to write to", () => {
    const s = scoreContact({ ...base, where: where("job_change", { to: " " }) }, today);
    expect(s).toEqual({
      score: 0,
      reasons: [{ reason: "Left Acme, new firm unknown", points: 0, cites: ["f5"] }],
      nextStep: "none",
    });
    expect(scoreContact({ ...base, where: where("left", {}) }, today).reasons[0]?.reason).toBe(
      "Left Acme, new firm unknown",
    );
  });

  it("reasons read in a recruiter's words, the signal first", () => {
    const moved = scoreContact(
      {
        ...base,
        where: where("job_change", { to: "Osborne", dates: "May 2026 - Present (4 months) in X" }),
        placed: { on: "2024-12-09", crmId: 3 },
      },
      today,
    );
    expect(moved.reasons.map((r) => r.reason)).toEqual([
      "Moved to Osborne 4 months ago",
      "Last placement Dec 2024",
    ]);
    const hiring = scoreContact(
      { ...base, where: where("still_there"), hiring: { id: 9, count: 1 } },
      today,
    );
    expect(hiring.reasons.map((r) => r.reason)).toEqual(["Acme has 1 open role", "Still at Acme"]);
    const quiet = scoreContact(
      { ...base, where: where("still_there"), contacted: { on: "2026-03-13", crmId: 2 } },
      today,
    );
    expect(quiet.reasons.map((r) => r.reason)).toEqual([
      "Still at Acme, nothing new",
      "Last contacted Mar 2026",
    ]);
    expect(scoreContact(base, today).reasons[0]?.reason).toBe("Not found yet, nothing new");
    expect(moved.reasons.some((r) => /\+\d/.test(r.reason))).toBe(false);
  });

  it("no signal is keep warm, even with recent history; same firm with hiring is reach out", () => {
    const still = { ...base, where: where("still_there"), placed: { on: "2026-09-01", crmId: 1 } };
    expect(scoreContact(still, today).nextStep).toBe("keep_warm");
    expect(scoreContact(base, today).nextStep).toBe("keep_warm");
    expect(scoreContact({ ...still, hiring: { id: 9, count: 3 } }, today).nextStep).toBe(
      "reach_out",
    );
  });
});

describe("startedAgo", () => {
  const at = new Date("2026-09-29T12:00:00Z");
  it("counts months from the start month a profile shows", () => {
    expect(startedAgo("Feb 2026 - Present (7 months) in Toronto", at)).toBe(" 7 months ago");
    expect(startedAgo("Aug 2026 - Present", at)).toBe(" 1 month ago");
    expect(startedAgo("Sep 2026 - Present", at)).toBe(" this month");
    expect(startedAgo("September 2024 - Present", at)).toBe(" 2 years ago");
    expect(startedAgo("Feb 2022 - Present (4 years and 7 months)", at)).toBe(" 4 years ago");
  });
  it("says nothing it can't read, or a start in the future", () => {
    for (const d of [null, "", "2021 - Present", "Present", "Dec 2026 - Present", 42])
      expect(startedAgo(d, at)).toBe("");
  });
});

describe("startedIn", () => {
  it("keeps the start month, drops duration and place", () => {
    expect(startedIn("Sep 2025 - Present (1 year) in Toronto, Ontario, Canada")).toBe("Sep 2025");
    expect(startedIn("September 2024 - Present")).toBe("Sep 2024");
    for (const d of [null, "", "2021 - Present", 42]) expect(startedIn(d)).toBeNull();
  });
});
