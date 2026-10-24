/**
 * The access review log (designs/2026-10-23-access-reviews.md): steps move one row per client and
 * kind, every step is kept, a refusal keeps its reason, a decision stops the rechecks.
 * Synthetic clients only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listReviews, logReview, reviewHistory, stateAfter } from "../../src/connect/review-log.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const at = (d: string) => new Date(`${d}T12:00:00Z`);

describe("review log", () => {
  it("a note keeps the state; answered files it again", () => {
    expect(stateAfter("more_info", "note")).toBe("more_info");
    expect(stateAfter("more_info", "answered")).toBe("filed");
    expect(stateAfter("filed", "checked")).toBe("filed");
  });

  it("filed, refused, filed again, passed: one row, four steps", async () => {
    const step = { client: "c_one", kind: "reddit-data-api", by: "test" } as const;
    const a = await logReview(pg.db, {
      ...step,
      event: "filed",
      ticket: "T1",
      at: at("2026-09-27"),
    });
    expect(a).toMatchObject({ state: "filed", ticket: "T1" });
    expect(a.nextCheckAt?.toISOString().slice(0, 10)).toBe("2026-10-04");

    const b = await logReview(pg.db, {
      ...step,
      event: "refused",
      note: "not aligned with policy",
      at: at("2026-09-29"),
    });
    expect(b).toMatchObject({
      state: "refused",
      reason: "not aligned with policy",
      nextCheckAt: null,
    });
    expect(b.decidedAt?.toISOString().slice(0, 10)).toBe("2026-09-29");

    const c = await logReview(pg.db, {
      ...step,
      event: "filed",
      ticket: "T2",
      at: at("2026-10-23"),
    });
    expect(c).toMatchObject({ state: "filed", ticket: "T2", decidedAt: null });
    expect(c.reason).toBe("not aligned with policy");

    await logReview(pg.db, { ...step, event: "passed", at: at("2026-10-30") });
    const h = await reviewHistory(pg.db, "c_one", "reddit-data-api");
    expect(h?.events.map((e) => e.kind)).toEqual(["filed", "refused", "filed", "passed"]);
    expect(h?.review.filedAt?.toISOString().slice(0, 10)).toBe("2026-10-23");
  });

  it("each client sees its own; a kind off the catalog keeps its name", async () => {
    await logReview(pg.db, {
      client: "c_two",
      kind: "a2p-10dlc",
      name: "A2P 10DLC campaign",
      event: "filed",
      by: "test",
    });
    const two = await listReviews(pg.db, "c_two");
    expect(two.map((v) => [v.kind, v.title, v.last?.kind])).toEqual([
      ["a2p-10dlc", "A2P 10DLC campaign", "filed"],
    ]);
    const all = await listReviews(pg.db);
    expect(all.map((v) => v.client)).toEqual(["c_one", "c_two"]);
    expect(all[0]?.title).toBe("Reddit Data API, commercial use");
  });
});
