import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildModels, type Lake, openLake } from "./lake-sync.js";
import { loadTrack } from "./lake-track.js";

const SESSION = "20261125T194917-40ac";
const T0 = Date.UTC(2026, 10, 25, 19, 49, 20);

let dir: string;
let bucket: string;
let lake: Lake;

const segment = (device: string, seg: string, events?: object[]) => {
  const d = join(bucket, device, SESSION, seg);
  mkdirSync(join(d, "frames"), { recursive: true });
  writeFileSync(join(d, "frames", "1.jpg"), "x");
  if (events)
    writeFileSync(
      join(d, "events.jsonl.gz"),
      gzipSync(events.map((e) => JSON.stringify(e)).join("\n")),
    );
};
const click = (t: number) => ({ kind: "click", t, ts: T0 + t, x: 10, y: 20, button: "left" });
const rows = async (sql: string) => (await lake.c.runAndReadAll(sql)).getRowObjectsJson();

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "lake-track-"));
  bucket = join(dir, "bucket");
  mkdirSync(join(bucket, "labels", "mac"), { recursive: true }); // not a session: skipped
  lake = await openLake({ dataPath: join(dir, "data"), catalogUrl: join(dir, "c.ducklake") });
});
afterEach(() => {
  lake.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("loadTrack", () => {
  it("loads each whole segment once, by device and day, and waits on one still uploading", async () => {
    segment("mac", "001", [click(0), click(500)]);
    segment("mac", "002"); // frames up, events not yet
    expect(await loadTrack(lake.c, bucket)).toMatchObject({ segments: 1, events: 2, waiting: 1 });
    expect(
      await rows(
        "SELECT device, session, segment, day::VARCHAR AS day, kind FROM lake.track.events LIMIT 1",
      ),
    ).toEqual([
      { device: "mac", session: SESSION, segment: "001", day: "2026-11-25", kind: "click" },
    ]);

    expect(await loadTrack(lake.c, bucket)).toMatchObject({ segments: 0, events: 0, waiting: 1 });

    segment("mac", "002", [click(1000)]);
    segment("pc", "001", []); // whole and empty: recorded, never read again
    expect(await loadTrack(lake.c, bucket, { batch: 1 })).toMatchObject({
      segments: 2,
      events: 1,
      waiting: 0,
    });
    expect(await rows("SELECT count(*)::INT AS n FROM lake.track.segments")).toEqual([{ n: 3 }]);
    expect(await loadTrack(lake.c, bucket)).toMatchObject({ segments: 0 });

    expect(await loadTrack(lake.c, bucket, { reload: true })).toMatchObject({
      segments: 3,
      events: 3,
    });
    expect(await rows("SELECT count(*)::INT AS n FROM lake.track.events")).toEqual([{ n: 3 }]);
  });

  it("feeds the autotrack models", async () => {
    segment("mac", "001", [click(0), click(500)]);
    await loadTrack(lake.c, bucket);
    const models = join(__dirname, "../../../lake/models");
    const only = join(dir, "models"); // the other models read wren's tables
    mkdirSync(only);
    for (const f of readdirSync(models).filter((f) => f.startsWith("autotrack_")))
      copyFileSync(join(models, f), join(only, f));
    await buildModels(lake, only, { trackPath: bucket });
    expect(
      await rows("SELECT device, act, kind FROM lake.warehouse.autotrack_acts ORDER BY act"),
    ).toEqual([
      { device: "mac", act: "1", kind: "click" },
      { device: "mac", act: "2", kind: "click" },
    ]);
  });
});

describe("autobrowse ledgers", () => {
  const ledger = (kind: string, month: string, lines: (object | string)[]) => {
    mkdirSync(join(bucket, "ledgers", kind), { recursive: true });
    const body = lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n");
    writeFileSync(join(bucket, "ledgers", kind, `${kind}-${month}.jsonl.gz`), gzipSync(body));
  };
  const build = async () => {
    const models = join(__dirname, "../../../lake/models");
    const only = join(dir, "models");
    mkdirSync(only);
    for (const f of readdirSync(models).filter((f) => f.startsWith("autobrowse_")))
      copyFileSync(join(models, f), join(only, f));
    return buildModels(lake, only, { trackPath: bucket });
  };
  const at = "2026-11-25T10:00:00.000Z";

  it("rolls calls, flows and engine runs up by site and day; drops a half-written line", async () => {
    ledger("calls", "2026-11", [
      {
        at,
        service: "s",
        site: "x",
        route: "post",
        attempt: 1,
        ok: true,
        status: 200,
        terminal: true,
        error: null,
        ms: 100,
        via: "api",
        from: "desk",
      },
      {
        at,
        service: "s",
        site: "x",
        route: "post",
        attempt: 2,
        ok: false,
        status: null,
        terminal: false,
        error: "boom",
        ms: 300,
        via: "browser",
      },
      '{"at":"2026-11-25T10:01',
    ]);
    ledger("flows", "2026-11", [
      {
        site: "x",
        flow: "post",
        startedAt: at,
        endedAt: at,
        ms: 5,
        outcome: "ok",
        submitted: true,
        acts: 3,
        captchaTries: 1,
        captchaSolved: true,
        captchas: [{ kind: "grid" }],
        llmCalls: 2,
        inputTokens: 10,
        outputTokens: 4,
        seed: 1,
      },
    ]);
    ledger("engine", "2026-11", [
      {
        workflow: "w",
        key: "k",
        site: "x",
        startedAt: at,
        endedAt: at,
        ms: 9,
        status: "failed",
        gate: null,
        steps: [
          { name: "open", status: "done" },
          { name: "read", status: "failed" },
        ],
      },
    ]);
    await build();
    expect(
      await rows('SELECT site, "from", via FROM lake.warehouse.autobrowse_calls ORDER BY attempt'),
    ).toEqual([
      { site: "x", from: "desk", via: "api" },
      { site: "x", from: null, via: "browser" },
    ]);
    expect(
      await rows(
        "SELECT step_count::INT AS n, failed_step FROM lake.warehouse.autobrowse_engine_runs",
      ),
    ).toEqual([{ n: 2, failed_step: "read" }]);
    expect(
      await rows(
        "SELECT site, day::VARCHAR AS day, calls::INT AS calls, calls_failed::INT AS failed, flows_ok::INT AS ok, input_tokens::INT AS tokens, engine_failed::INT AS runs_failed FROM lake.warehouse.autobrowse_site_daily",
      ),
    ).toEqual([
      { site: "x", day: "2026-11-25", calls: 2, failed: 1, ok: 1, tokens: 10, runs_failed: 1 },
    ]);
  });

  it("builds empty tables before the desk shipped anything", async () => {
    await build();
    expect(
      await rows("SELECT count(*)::INT AS n FROM lake.warehouse.autobrowse_site_daily"),
    ).toEqual([{ n: 0 }]);
  });
});
