/** Holds and counts on Postgres: 7 days, one retry, then a person; a source under 70% of 50 pauses. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  counted,
  hold,
  holdsOn,
  isHeld,
  PAUSE_WINDOW,
  pausedSources,
  release,
  retryDue,
  settle,
} from "../../src/checks.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => pg.db.execute(sql`truncate unit_holds, check_outcomes`));

const row = async (subject: string) => {
  const [r] = await pg.db.execute<{
    id: number;
    tries: number;
    forever: boolean;
    state: string;
  }>(sql`
    select h.id, h.tries, h.until = 'infinity' forever, v.state
    from unit_holds h join unit_holds_now v on v.id = h.id where h.subject = ${subject}`);
  return r;
};
const ran = (subject: string) =>
  pg.db.execute(
    sql`update unit_holds set until = now() - interval '1 second' where subject = ${subject}`,
  );
const flags = async (subject: string) => {
  const [r] = await pg.db.execute<{ held: boolean; due: boolean }>(sql`
    select ${isHeld("s", sql`${subject}`)} held, ${retryDue("s", sql`${subject}`)} due`);
  return r;
};

describe("holds", () => {
  it("holds 7 days, retries once, then waits for a person; a release runs it again", async () => {
    await hold(pg.db, { stage: "s", subject: "1", reason: "boom", spent: true });
    expect(await row("1")).toMatchObject({ tries: 1, forever: false, state: "held" });
    expect(await flags("1")).toEqual({ held: true, due: false });
    expect(await holdsOn(pg.db, "s")).toEqual({ held: ["1"], due: [] });

    await ran("1");
    expect(await flags("1")).toEqual({ held: false, due: true });
    expect(await holdsOn(pg.db, "s")).toEqual({ held: [], due: ["1"] });
    // A score that sees it again before its retry changes nothing.
    await hold(pg.db, { stage: "s", subject: "1", reason: "still" });
    expect(await row("1")).toMatchObject({ tries: 1, forever: false, state: "due" });

    await hold(pg.db, { stage: "s", subject: "1", reason: "boom again", spent: true });
    expect(await row("1")).toMatchObject({ tries: 2, forever: true, state: "stuck" });

    const h = await row("1");
    expect(await release(pg.db, [h?.id as number], "op@example.com")).toHaveLength(1);
    expect(await row("1")).toMatchObject({ state: "released" });
    expect(await flags("1")).toEqual({ held: false, due: false });
    // Failing after a release starts over.
    await hold(pg.db, { stage: "s", subject: "1", reason: "boom", spent: true });
    expect(await row("1")).toMatchObject({ tries: 1, forever: false, state: "held" });
  });

  it("a retry that lands settles its hold", async () => {
    await hold(pg.db, { stage: "s", subject: "2", reason: "boom" });
    expect(await settle(pg.db, "s", ["2", "3"])).toBe(1);
    expect(await row("2")).toMatchObject({ state: "released" });
  });
});

describe("counted", () => {
  const out = (ok: boolean) =>
    counted(pg.db, { stage: "p", source: "google", check: "page is the firm's", ok });

  it("pauses a source under 70% of its last 50, and a release starts a fresh window", async () => {
    for (let i = 0; i < 35; i++) await out(true);
    for (let i = 0; i < 14; i++) expect(await out(false)).toBe(false);
    // 35 of 50: exactly 70% still runs.
    expect(await out(false)).toBe(false);
    expect(await out(false)).toBe(true);
    expect(await pausedSources(pg.db, "p")).toEqual(new Set(["google"]));
    const [rate] = await pg.db.execute<{ state: string; total: number }>(
      sql`select state, total from check_rates where source = 'google'`,
    );
    expect(rate).toEqual({ state: "paused", total: 51 });

    const h = await row("source:google");
    await release(pg.db, [h?.id as number], "op@example.com");
    expect(await pausedSources(pg.db, "p")).toEqual(new Set());
    for (let i = 0; i < PAUSE_WINDOW - 1; i++) expect(await out(false)).toBe(false);
    expect(await out(false)).toBe(true);
  });

  it("a counted-only check never pauses", async () => {
    for (let i = 0; i < 60; i++)
      await counted(pg.db, { stage: "t", source: "exa", check: "x", ok: false, pauses: false });
    expect(await pausedSources(pg.db, "t")).toEqual(new Set());
  });
});
