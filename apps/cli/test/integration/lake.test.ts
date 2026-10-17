/**
 * The lake against a real Postgres (designs/2026-10-11-lake.md): a first sync copies every table,
 * the next moves only what changed, secrets never land, and the lake reads as it was.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
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

const MODELS = resolve(__dirname, "../../../../lake/models");
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
  pg = await startTestPostgres({ own: true });
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
    const skipped: string[] = [];
    const built = await inLake((lake) =>
      buildModels(lake, MODELS, { onSkip: (m) => skipped.push(m) }),
    );
    // No WREN_LAKE_TRACK_PATH: the autotrack models say so and wait.
    expect(skipped).toEqual(["autotrack_acts", "autotrack_daily", "autotrack_episodes"]);
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

// autotrack's bucket, a directory standing in: gzipped events per segment, labels per session.
// A lake of its own (a local catalog): these models read only the bucket.
describe("wren lake: autotrack models", () => {
  const T0 = Date.UTC(2026, 9, 13, 10, 0, 0);
  const chrome = { name: "Google Chrome", id: "com.google.Chrome", pid: 1 };
  const notes = { name: "Notes", id: "com.apple.Notes", pid: 2 };
  const out = (screen: boolean) => ({ screen, focus: false, dialog: false, window: false });
  let scratch: string;
  let track: string;
  let models: string;
  const put = (rel: string, body: string | Buffer) => {
    mkdirSync(dirname(join(track, rel)), { recursive: true });
    writeFileSync(join(track, rel), body);
  };
  const events = (rel: string, list: object[]) =>
    put(rel, gzipSync(`${list.map((e) => JSON.stringify(e)).join("\n")}\n`));
  const lake = (readOnly = false) =>
    openLake({
      dataPath: `${scratch}/lake/`,
      catalogUrl: join(scratch, "lake.ducklake"),
      trackPath: `${track}/`,
      ...(readOnly ? { readOnly } : {}),
    });
  const build = async () => {
    const l = await lake();
    try {
      return await buildModels(l, models, { trackPath: `${track}/` });
    } finally {
      l.close();
    }
  };
  const ask2 = async (q: string) => {
    const l = await lake(true);
    try {
      return await query(l, q);
    } finally {
      l.close();
    }
  };

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "wren-track-"));
    track = join(scratch, "track");
    models = join(scratch, "models");
    mkdirSync(join(scratch, "lake"));
    mkdirSync(models);
    for (const f of readdirSync(MODELS).filter((f) => f.startsWith("autotrack_")))
      copyFileSync(join(MODELS, f), join(models, f));
    events("mac1/S1/000/events.jsonl.gz", [
      { kind: "focus", t: 0, ts: T0 - 1000, app: chrome },
      { kind: "move", t: 500, ts: T0 - 500, x: 90, y: 190, app: chrome },
      {
        kind: "click",
        t: 1000,
        ts: T0,
        x: 100,
        y: 200,
        button: "left",
        count: 1,
        app: chrome,
        window: { title: "Leads", x: 0, y: 0, width: 10, height: 10 },
        element: {
          role: "AXButton",
          name: "",
          x: 90,
          y: 190,
          width: 30,
          height: 20,
          secure: false,
        },
        out: out(true),
      },
      {
        kind: "web",
        act: "click",
        ts: T0 + 40,
        tab: 1,
        frame: 0,
        x: 101,
        y: 199,
        url: "https://www.app.example.test/leads",
        title: "Leads",
        target: { tag: "button", role: "button", name: "Approve" },
      },
      {
        kind: "app",
        ts: T0 + 300,
        url: "https://www.app.example.test/leads",
        action: "marketing/approveDraft",
        detail: { ids: { ids: [7] }, ok: true },
      },
      {
        kind: "click",
        t: 11_000,
        ts: T0 + 10_000,
        x: 500,
        y: 500,
        button: "left",
        count: 1,
        app: notes,
        element: {
          role: "AXButton",
          name: "Save",
          x: 490,
          y: 490,
          width: 30,
          height: 20,
          secure: false,
        },
        out: out(false),
      },
      {
        kind: "text",
        t: 21_000,
        ts: T0 + 20_000,
        text: "",
        redacted: true,
        app: notes,
        out: out(true),
      },
    ]);
    events("mac1/S1/001/events.jsonl.gz", [
      {
        kind: "key",
        t: 600_000,
        ts: T0 + 600_000,
        key: "enter",
        mods: [],
        app: chrome,
        out: out(true),
      },
    ]);
    events("win1/S2/000/events.jsonl.gz", [
      {
        kind: "click",
        t: 100,
        ts: T0 + 5000,
        x: 5,
        y: 5,
        button: "left",
        count: 1,
        app: { name: "notepad", id: "C:/notepad.exe", pid: 3 },
      },
    ]);
  });

  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("loads acts with no labels yet, joining the page and Wren's command", async () => {
    const built = await build();
    expect(built.map((m) => m.model)).toEqual([
      "autotrack_acts",
      "autotrack_daily",
      "autotrack_episodes",
    ]);
    expect(
      await ask2(
        `SELECT device, act::INT AS act, kind, app_name, domain, element_role, element_name, intent,
                span_s::DOUBLE AS span_s, app_actions[1].action AS cmd, app_actions[1].ok AS ok
         FROM warehouse.autotrack_acts ORDER BY device, session, act`,
      ),
    ).toEqual([
      // The OS click's thin element is replaced by the page's target; Wren said what it meant.
      {
        device: "mac1",
        act: 1,
        kind: "click",
        app_name: "Google Chrome",
        domain: "app.example.test",
        element_role: "button",
        element_name: "Approve",
        intent: null,
        span_s: 10,
        cmd: "marketing/approveDraft",
        ok: true,
      },
      // Notes isn't a browser: the page's domain doesn't spill over.
      {
        device: "mac1",
        act: 2,
        kind: "click",
        app_name: "Notes",
        domain: null,
        element_role: "AXButton",
        element_name: "Save",
        intent: null,
        span_s: 10,
        cmd: null,
        ok: null,
      },
      {
        device: "mac1",
        act: 3,
        kind: "text",
        app_name: "Notes",
        domain: null,
        element_role: null,
        element_name: null,
        intent: null,
        span_s: 30,
        cmd: null,
        ok: null,
      },
      {
        device: "mac1",
        act: 4,
        kind: "key",
        app_name: "Google Chrome",
        domain: null,
        element_role: null,
        element_name: null,
        intent: null,
        span_s: 0,
        cmd: null,
        ok: null,
      },
      {
        device: "win1",
        act: 1,
        kind: "click",
        app_name: "notepad",
        domain: null,
        element_role: null,
        element_name: null,
        intent: null,
        span_s: 0,
        cmd: null,
        ok: null,
      },
    ]);
    expect(await ask2("SELECT count(*)::INT AS n FROM warehouse.autotrack_episodes")).toEqual([
      { n: 0 },
    ]);
    expect(
      await ask2(
        `SELECT device, day::VARCHAR AS day, acts::INT AS acts, active_minutes::INT AS minutes,
                dead_rate, apps[1].app AS top_app, domains[1].domain AS top_domain
         FROM warehouse.autotrack_daily ORDER BY device`,
      ),
    ).toEqual([
      {
        device: "mac1",
        day: "2026-10-13",
        acts: 4,
        minutes: 2,
        dead_rate: null,
        top_app: "Notes",
        top_domain: "app.example.test",
      },
      {
        device: "win1",
        day: "2026-10-13",
        acts: 1,
        minutes: 1,
        dead_rate: null,
        top_app: "notepad",
        top_domain: null,
      },
    ]);
  }, 120_000);

  it("adds intent, signals and episodes once labels land", async () => {
    put(
      "labels/mac1/S1.json",
      JSON.stringify(
        {
          v: 1,
          session: "S1",
          episodes: [
            {
              id: "e1",
              start: 1000,
              end: 21_000,
              goal: "Approve a draft",
              goalBy: "model",
              outcome: "done",
              confidence: 0.9,
            },
          ],
          acts: [
            {
              t: 1000,
              episode: "e1",
              intent: "approve the draft",
              signals: {
                dwell: 1000,
                hover: 300,
                dead: false,
                rage: false,
                correction: false,
                error: false,
              },
            },
            {
              t: 11_000,
              episode: "e1",
              intent: "save the note",
              signals: { dwell: 10_000, dead: true, rage: false, correction: false, error: false },
            },
          ],
        },
        null,
        2,
      ),
    );
    await build();
    expect(
      await ask2(
        `SELECT act::INT AS act, episode, intent, dwell::INT AS dwell, hover::INT AS hover, dead
         FROM warehouse.autotrack_acts WHERE device = 'mac1' ORDER BY act`,
      ),
    ).toEqual([
      { act: 1, episode: "e1", intent: "approve the draft", dwell: 1000, hover: 300, dead: false },
      { act: 2, episode: "e1", intent: "save the note", dwell: 10_000, hover: null, dead: true },
      { act: 3, episode: null, intent: null, dwell: null, hover: null, dead: null },
      { act: 4, episode: null, intent: null, dwell: null, hover: null, dead: null },
    ]);
    expect(
      await ask2(
        `SELECT device, episode, goal, goal_by, outcome, confidence, acts::INT AS acts, dead::INT AS dead,
                apps::VARCHAR AS apps, domains::VARCHAR AS domains
         FROM warehouse.autotrack_episodes`,
      ),
    ).toEqual([
      {
        device: "mac1",
        episode: "e1",
        goal: "Approve a draft",
        goal_by: "model",
        outcome: "done",
        confidence: 0.9,
        acts: 2,
        dead: 1,
        apps: "[Google Chrome, Notes]",
        domains: "[app.example.test]",
      },
    ]);
    expect(
      await ask2(
        "SELECT labelled_acts::INT AS labelled, dead_rate FROM warehouse.autotrack_daily WHERE device = 'mac1'",
      ),
    ).toEqual([{ labelled: 2, dead_rate: 0.5 }]);
  }, 120_000);

  it("an empty bucket builds empty tables", async () => {
    rmSync(track, { recursive: true, force: true });
    mkdirSync(track);
    await build();
    expect(await ask2("SELECT count(*)::INT AS n FROM warehouse.autotrack_acts")).toEqual([
      { n: 0 },
    ]);
  }, 120_000);
});
