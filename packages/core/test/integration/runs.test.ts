/** The run ledger: a stage invocation is a row, opened before work and closed with stats. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finishRun, recordedRun } from "../../src/runs.js";
import { runs } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const rowFor = async (id: string) => (await pg.db.select().from(runs).where(eq(runs.id, id)))[0];

describe("recordedRun", () => {
  it("opens before work and closes with stats", async () => {
    const { run, stats } = await recordedRun(
      pg.db,
      { command: "enrich scan", argv: { limit: 5 }, niche: "agencies" },
      async (run) => {
        const row = await rowFor(run.id);
        expect(row?.finishedAt).toBeNull(); // exists before the first unit
        const out = { selected: 5, aborted: null };
        await finishRun(pg.db, run.id, out); // the body's own close; the wrapper's is a no-op
        return out;
      },
    );
    expect(stats).toEqual({ selected: 5, aborted: null });
    const row = await rowFor(run.id);
    expect(row).toMatchObject({
      command: "enrich scan",
      niche: "agencies",
      argv: { limit: 5 },
      stats: { selected: 5, aborted: null },
    });
    expect(row?.finishedAt).not.toBeNull();
  });

  it("records errors and still throws", async () => {
    let id = "";
    await expect(
      recordedRun(pg.db, { command: "enrich extract", argv: {} }, async (run) => {
        id = run.id;
        throw new RangeError("provider exploded");
      }),
    ).rejects.toThrow("provider exploded");
    const row = await rowFor(id);
    expect(row?.stats).toEqual({ error: "RangeError: provider exploded" });
    expect(row?.finishedAt).not.toBeNull();
  });
});
