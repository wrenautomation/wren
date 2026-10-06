/** Run-ledger retention: old finished chatty runs go unless a row of any table points at them. */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pruneRuns } from "../../src/retention.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const NOW = new Date("2026-10-06T12:00:00Z");
const run = async (id: string, command: string, daysAgo: number, finished = true) =>
  pg.db.execute(sql`INSERT INTO runs (id, command, argv, started_at, finished_at)
    VALUES (${id}, ${command}, '{}', ${NOW.toISOString()}::timestamptz - ${daysAgo} * interval '1 day',
            ${finished ? NOW.toISOString() : null})`);
const left = async () =>
  (await pg.db.execute<{ id: string }>(sql`SELECT id FROM runs ORDER BY id`)).map((r) => r.id);
const id = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

describe("pruneRuns", () => {
  it("deletes old finished sync and tick runs nothing references", async () => {
    await run(id(1), "send tick", 40); // goes
    await run(id(2), "outreach inbox sync", 31); // goes
    await run(id(3), "send tick", 10); // too young
    await run(id(4), "send tick", 40, false); // still open
    await run(id(5), "enrich scan", 90); // not a chatty command
    await run(id(6), "send tick", 40); // a table row points at it
    await pg.db.execute(sql`INSERT INTO postmaster_days (domain, day, raw, run_id)
      VALUES ('example.test', '2026-08-01', '{}', ${id(6)})`);
    expect(await pruneRuns(pg.db, NOW)).toBe(2);
    expect(await left()).toEqual([id(3), id(4), id(5), id(6)]);
    expect(await pruneRuns(pg.db, NOW)).toBe(0);
  });

  it("lets cascade keys follow the delete", async () => {
    await run(id(7), "send tick", 40);
    await pg.db.execute(sql`INSERT INTO run_events (run_id, step, kind, line)
      VALUES (${id(7)}, 'tick', 'did', 'sent')`);
    expect(await pruneRuns(pg.db, NOW)).toBe(1);
    const [n] = await pg.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM run_events WHERE run_id = ${id(7)}`,
    );
    expect(n?.n).toBe("0");
  });
});
