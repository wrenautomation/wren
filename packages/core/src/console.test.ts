import type { Db } from "@wren/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { consoleApi, type LoopRow, loopsOf, toCsv } from "./console.js";
import { PortalRefusal } from "./portal.js";

const rows = Object.assign([{ niche: "widgets", in_play: "12", note: 'a "b", c' }], {
  columns: [
    { name: "niche", type: 1043 },
    { name: "in_play", type: 20 },
    { name: "note", type: 25 },
  ],
});
const asked: string[] = [];
const main = {
  execute: async (q: SQL) => {
    asked.push(new PgDialect().sqlToQuery(q).sql);
    return rows;
  },
} as unknown as Db;
const api = consoleApi({ main, views: ["pipeline_funnel", "books.spend"] });
const operator = { email: "op@example.test", operator: true };

const refused = async (p: Promise<unknown>, status: number) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PortalRefusal);
  expect((err as PortalRefusal).status).toBe(status);
};

describe("ConsolePortal view", () => {
  it("refuses anyone but Wren's team", async () => {
    await refused(api.view({ viewer: { email: "amy@acme.test" }, view: "pipeline_funnel" }), 403);
    await refused(api.view({ viewer: { demo: true }, view: "pipeline_funnel" }), 403);
    await refused(api.view({ viewer: operator, asClient: true, view: "pipeline_funnel" }), 403);
  });

  it("refuses a view that isn't allowed", async () => {
    await refused(api.view({ viewer: operator, view: "person_facts" }), 404);
    await refused(api.view({ viewer: operator, view: "toString" }), 404);
  });

  it("answers columns and rows, counts as numbers", async () => {
    expect(await api.view({ viewer: operator, view: "pipeline_funnel" })).toEqual({
      view: "pipeline_funnel",
      columns: ["niche", "in_play", "note"],
      rows: [["widgets", 12, 'a "b", c']],
    });
  });

  it("reads a schema's view with each part quoted", async () => {
    await api.view({ viewer: operator, view: "books.spend" });
    expect(asked.at(-1)).toBe('SELECT * FROM "books"."spend" LIMIT $1');
  });

  it("answers CSV, quoting where needed", async () => {
    const csv = await api.view({ viewer: operator, view: "pipeline_funnel", format: "csv" });
    expect(csv).toEqual({
      view: "pipeline_funnel",
      csv: 'niche,in_play,note\r\nwidgets,12,"a ""b"", c"',
    });
    expect(toCsv({ columns: ["a"], rows: [[null]] })).toBe("a\r\n");
  });
});

const state = (service: string, key: string, k: string, value: unknown, next?: string) => ({
  service_name: service,
  service_key: key,
  key: k,
  value_utf8: JSON.stringify(value),
  ...(next ? { scheduled_at: "2026-01-01T00:00:00.000Z", scheduled_start_at: next } : {}),
});
const pass = (now: string, failures = 0, error: string | null = null) => ({
  stats: null,
  error,
  failures,
  delayMs: 60_000,
  now,
});
const ADMIN_ROWS = [
  state("Alpha", "fleet", "running", true, "2026-01-02T10:00:00.000Z"),
  state("Alpha", "fleet", "last", pass("2026-01-02T09:00:00.000Z"), "2026-01-02T10:00:00.000Z"),
  state("Beta", "one", "running", false),
  state("Beta", "one", "last", pass("2026-01-01T08:00:00.000Z", 3)),
  state("Gamma", "x", "running", true, "2026-01-02T12:00:00.000Z"),
  state("Gamma", "x", "running", true, "2026-01-02T11:00:00.000Z"),
  state("NotALoop", "k", "last", pass("2026-01-01T00:00:00.000Z")),
];

describe("ConsolePortal loops", () => {
  const loops = consoleApi({ main, views: [], admin: async () => ADMIN_ROWS });

  it("one row per object with a running key, failing first, the soonest next call", () => {
    expect(loopsOf(ADMIN_ROWS)).toEqual<LoopRow[]>([
      {
        service: "Beta",
        key: "one",
        running: false,
        lastAt: "2026-01-01T08:00:00.000Z",
        failures: 3,
        error: null,
        nextAt: null,
      },
      {
        service: "Alpha",
        key: "fleet",
        running: true,
        lastAt: "2026-01-02T09:00:00.000Z",
        failures: 0,
        error: null,
        nextAt: "2026-01-02T10:00:00.000Z",
      },
      {
        service: "Gamma",
        key: "x",
        running: true,
        lastAt: null,
        failures: 0,
        error: null,
        nextAt: "2026-01-02T11:00:00.000Z",
      },
    ]);
  });

  it("refuses anyone but Wren's team, and a worker with no admin URL", async () => {
    await refused(loops.loops({ viewer: { email: "amy@acme.test" } }), 403);
    await refused(loops.loops({ viewer: operator, asClient: true }), 403);
    await refused(api.loops({ viewer: operator }), 503);
    expect(await loops.loops({ viewer: operator })).toHaveLength(3);
  });

  it("sets only a loop the read returned", () => {
    const listed = loopsOf(ADMIN_ROWS);
    const ask = { viewer: operator, service: "Alpha", key: "fleet", run: false };
    expect(loops.pick(ask, listed).service).toBe("Alpha");
    expect(() => loops.pick({ ...ask, key: "other" }, listed)).toThrow("no such loop");
    expect(() => loops.pick({ ...ask, service: "NotALoop", key: "k" }, listed)).toThrow(
      "no such loop",
    );
    expect(() => loops.pick({ ...ask, run: "yes" as unknown as boolean }, listed)).toThrow(
      "say run",
    );
  });
});
