/**
 * Dictation's timings in the run ledger: a saved dictation is a finished `dictate` run with no
 * words, and the Latency panel reads p50 and p95 per adapter and stage over 30 days.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Dictated, dictationStats, saveDictation } from "../../src/dictation-store.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["runs"]);
});

const run = (over: Partial<Dictated> = {}): Dictated => ({
  adapter: "browser",
  model: "moonshine-base",
  micMs: 100,
  firstMs: 50,
  finalMs: 300,
  loadMs: null,
  words: 6,
  audioMs: 2400,
  ...over,
});

describe("dictation timings", () => {
  it("keeps a run per dictation and reads p50/p95 per adapter and stage", async () => {
    for (const finalMs of [200, 300, 400]) await saveDictation(pg.db, run({ finalMs }));
    await saveDictation(pg.db, run({ loadMs: 8000 }));
    await saveDictation(pg.db, run({ adapter: "server", model: "whisper-test", firstMs: null }));

    const stats = await dictationStats(pg.db);
    const browser = stats.filter((s) => s.adapter === "browser");
    expect(browser.map((s) => s.stage)).toEqual(["load", "mic", "first", "final"]);
    expect(browser.find((s) => s.stage === "final")).toEqual({
      adapter: "browser",
      stage: "final",
      p50: 300,
      p95: 385,
      n: 4,
    });
    expect(browser.find((s) => s.stage === "load")).toMatchObject({ p50: 8000, n: 1 });
    // A stage it never reached isn't a zero.
    expect(stats.filter((s) => s.adapter === "server").map((s) => s.stage)).toEqual([
      "mic",
      "final",
    ]);

    const rows = await pg.db.execute<{ command: string; done: boolean; stats: object }>(
      sql`SELECT command, finished_at IS NOT NULL AS done, stats FROM runs`,
    );
    expect(rows.every((r) => r.command === "dictate" && r.done)).toBe(true);
    // Counts and times only: never what was said.
    expect(Object.keys(rows[0]?.stats ?? {}).sort()).toEqual(
      ["audioMs", "finalMs", "firstMs", "loadMs", "micMs", "words"].sort(),
    );
  });

  it("drops runs older than the ledger keeps, and refuses a bad report", async () => {
    await saveDictation(pg.db, run());
    expect(await dictationStats(pg.db, new Date(Date.now() + 31 * 86_400_000))).toEqual([]);
    await expect(saveDictation(pg.db, run({ micMs: -1 }))).rejects.toThrow();
    await expect(
      saveDictation(pg.db, { ...run(), adapter: "phone" } as unknown as Dictated),
    ).rejects.toThrow();
  });
});
