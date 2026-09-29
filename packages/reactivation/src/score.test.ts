import { describe, expect, it } from "vitest";
import { POINTS, type ScoreInput, scoreContact } from "./score.js";

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
      reasons: [{ reason: "left Acme Staffing", points: 0, cites: ["f5"] }],
    });
  });

  it("hiring counts less when we don't know they're still there", () => {
    const s = scoreContact({ ...base, hiring: { id: 9, count: 2 } }, today);
    expect(s.score).toBe(POINTS.unknown + POINTS.hiringUnknown);
    expect(s.reasons[0]).toEqual({ reason: "Acme has 2 open roles", points: 30, cites: ["f9"] });
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
    expect(s.reasons).toEqual([{ reason: "moved to Beta as VP Ops", points: 70, cites: ["f5"] }]);
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

  it("blank values fall back to plain words", () => {
    expect(
      scoreContact({ ...base, where: where("job_change", { to: " " }) }, today).reasons[0]?.reason,
    ).toBe("moved to a new company");
    expect(scoreContact({ ...base, where: where("left", {}) }, today).reasons[0]?.reason).toBe(
      "left Acme",
    );
  });
});
