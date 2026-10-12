/**
 * The lake against a real Postgres (designs/2026-10-11-lake.md): a first sync copies every table,
 * the next moves only what changed, secrets never land, and the lake reads as it was.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildModels,
  type Lake,
  openLake,
  query,
  status,
  syncDatabase,
} from "../../src/lake-sync.js";

let pg: TestPostgres;
let dir: string;
let catalogUrl: string;
const open = (at?: string) =>
  openLake({ dataPath: `${dir}/`, catalogUrl, ...(at ? { at, readOnly: true } : {}) });
const inLake = async <T>(fn: (lake: Lake) => Promise<T>, at?: string) => {
  const lake = await open(at);
  try {
    return await fn(lake);
  } finally {
    lake.close();
  }
};
const ask = (q: string, at?: string) => inLake((lake) => query(lake, q), at);
const byTable = (r: Awaited<ReturnType<typeof syncDatabase>>) =>
  Object.fromEntries(r.tables.map((t) => [t.table, t]));

beforeAll(async () => {
  pg = await startTestPostgres();
  dir = mkdtempSync(join(tmpdir(), "wren-lake-"));
  await pg.db.execute("CREATE DATABASE wren_lake");
  const url = new URL(pg.url);
  url.pathname = "/wren_lake";
  catalogUrl = url.toString();
  await pg.db.execute(`
    CREATE TABLE lake_pair (a int, b date, v text, webhook_secret text, PRIMARY KEY (a, b));
    CREATE TABLE lake_loose (a int, b text);
    INSERT INTO lake_pair VALUES (1, '2026-10-01', 'one', 's1'), (2, '2026-10-01', 'two', 's2');
    INSERT INTO lake_loose VALUES (1, 'x'), (2, 'y');
    INSERT INTO runs (id, command, argv, started_at, finished_at, stats) VALUES
      ('00000000-0000-4000-8000-000000000001', 'sms tick', '[]', '2026-10-10T10:00:00Z', '2026-10-10T10:00:02Z', '{}'),
      ('00000000-0000-4000-8000-000000000002', 'sms tick', '[]', '2026-10-10T10:05:00Z', '2026-10-10T10:05:01Z', '{"error":"x"}');
  `);
}, 240_000);

afterAll(async () => {
  await pg?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("wren lake", () => {
  let before: string;

  it("a first sync copies every table, secrets left out", async () => {
    const r = await inLake((lake) => syncDatabase(lake, pg.url, null));
    const t = byTable(r);
    expect(r.tables.filter((x) => x.result === "failed")).toEqual([]);
    expect(r.tables.every((x) => x.result === "created")).toBe(true);
    expect(t["wren.runs"]).toMatchObject({ rows: 2 });
    expect(t["wren.lake_pair"]).toMatchObject({ rows: 2 });
    const cols = await ask("SELECT column_name FROM (DESCRIBE wren.lake_pair)");
    expect(cols.map((c) => c.column_name)).toEqual(["a", "b", "v", "_h"]);
    const [snap] = await ask("SELECT max(snapshot_id) AS s FROM lake.snapshots()");
    before = String(snap?.s);
  }, 240_000);

  it("the next sync moves only what changed", async () => {
    await pg.db.execute(`
      UPDATE lake_pair SET v = 'uno' WHERE a = 1;
      INSERT INTO lake_pair VALUES (3, '2026-10-02', 'three', 's3');
      DELETE FROM lake_pair WHERE a = 2;
      DELETE FROM lake_loose WHERE a = 1;
      INSERT INTO lake_loose VALUES (3, 'z');
      ALTER TABLE lake_pair ADD COLUMN note text;
    `);
    const t = byTable(await inLake((lake) => syncDatabase(lake, pg.url, null)));
    // A new column changes every row's text: every row moves.
    expect(t["wren.lake_pair"]).toMatchObject({ result: "changed", rows: 2 });
    expect(t["wren.lake_loose"]).toMatchObject({ result: "changed", upserted: 1, removed: 1 });
    expect(t["wren.runs"]).toMatchObject({ result: "unchanged" });
    expect(await ask("SELECT a, v, note FROM wren.lake_pair ORDER BY a")).toEqual([
      { a: 1, v: "uno", note: null },
      { a: 3, v: "three", note: null },
    ]);
    expect(await ask("SELECT a, b FROM wren.lake_loose ORDER BY a")).toEqual([
      { a: 2, b: "y" },
      { a: 3, b: "z" },
    ]);
  }, 240_000);

  it("a few changed rows are fetched by key", async () => {
    await pg.db.execute(`
      UPDATE runs SET stats = '{"sent":1}' WHERE id = '00000000-0000-4000-8000-000000000001';
      INSERT INTO runs (id, command, argv, started_at, finished_at, stats) VALUES
        ('00000000-0000-4000-8000-000000000003', 'reach tick', '[]', '2026-10-11T10:00:00Z', '2026-10-11T10:00:03Z', '{}');
    `);
    const t = byTable(
      await inLake((lake) => syncDatabase(lake, pg.url, null, (x) => x.name === "runs")),
    );
    expect(Object.keys(t)).toEqual(["wren.runs"]);
    expect(t["wren.runs"]).toMatchObject({ result: "changed", upserted: 2, removed: 0, rows: 3 });
    const [one] = await ask(
      "SELECT stats ->> 'sent' AS sent FROM wren.runs WHERE id = '00000000-0000-4000-8000-000000000001'",
    );
    expect(one?.sent).toBe("1");
  }, 240_000);

  it("reads the lake as it was", async () => {
    expect(await ask("SELECT a, v FROM wren.lake_pair ORDER BY a", before)).toEqual([
      { a: 1, v: "one" },
      { a: 2, v: "two" },
    ]);
  }, 240_000);

  it("builds the warehouse's models", async () => {
    const built = await inLake((lake) =>
      buildModels(lake, resolve(__dirname, "../../../../lake/models")),
    );
    expect(built.map((m) => m.model)).toEqual(["loop_passes_daily", "outbound_daily"]);
    expect(
      await ask(
        "SELECT command, day::VARCHAR AS day, passes::INT AS passes, errored::INT AS errored FROM warehouse.loop_passes_daily ORDER BY ALL",
      ),
    ).toEqual([
      { command: "reach tick", day: "2026-10-11", passes: 1, errored: 0 },
      { command: "sms tick", day: "2026-10-10", passes: 2, errored: 1 },
    ]);
    const s = await inLake((lake) => status(lake));
    expect(s.tables).toContainEqual(
      expect.objectContaining({ schema: "wren", table: "lake_pair" }),
    );
    expect(s.last).not.toBeNull();
  }, 240_000);
});
