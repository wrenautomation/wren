import { TerminalError } from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  consoleApi,
  formOf,
  handlerRecord,
  handlersOf,
  inputSchemaOf,
  type LoopRow,
  loopsOf,
  makeConsolePortal,
  restateAdminGet,
  toCsv,
} from "./console.js";
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

describe("ConsolePortal records", () => {
  const recs = consoleApi({ main, views: [], admin: async () => ADMIN_ROWS });
  const record = "console.loop";

  it("refuses the demo and clients on every records route", async () => {
    for (const viewer of [{ demo: true as const }, { email: "amy@acme.test" }]) {
      await refused(recs.recordsTypes({ viewer }), 403);
      await refused(recs.recordsList({ viewer, record }), 403);
      await refused(recs.recordsGet({ viewer, record, id: "Tick/a" }), 403);
      await refused(recs.recordsExport({ viewer, record }), 403);
      await refused(recs.recordsStats({ viewer, record, period: 7 }), 403);
    }
    await refused(recs.recordsList({ viewer: operator, asClient: true, record }), 403);
  });

  it("lists the loops as a record for the team, with start and stop", async () => {
    const [loop] = await recs.recordsTypes({ viewer: operator });
    expect(loop).toMatchObject({ id: record, actions: ["console.startLoop", "console.stopLoop"] });
    expect(await consoleApi({ main, views: [] }).recordsTypes({ viewer: operator })).toEqual([]);
  });
});

const handler = (name: string, more: Record<string, unknown> = {}) => ({ name, ...more });
const SCHEMA = { type: "object", properties: { limit: { type: "integer" } } };
/** A portal-style input: `call` fills the viewer. */
const ASKS = {
  type: "object",
  properties: { viewer: { type: "object" }, id: { type: "number" } },
  required: ["id"],
};

const SERVICES = {
  services: [
    {
      name: "Widgets",
      ty: "VirtualObject",
      handlers: [
        handler("launch", { metadata: { effect: "spends" }, input_json_schema: SCHEMA }),
        handler("status", { ty: "Shared" }),
        handler("loop", { public: false }),
      ],
    },
    { name: "Tally", ty: "Service", handlers: [handler("count", { input_json_schema: SCHEMA })] },
    { name: "Inbox", ty: "Service", handlers: [handler("approve", { input_json_schema: ASKS })] },
    { name: "WidgetsPortal", ty: "Service", handlers: [handler("view")] },
    { name: "Hidden", ty: "Service", public: false, handlers: [handler("any")] },
  ],
};

describe("ConsolePortal handlers", () => {
  const get = async (path: string) =>
    path === "/services"
      ? SERVICES
      : {
          paths: {
            "/restate/call/Widgets/{key}/launch": {
              post: {
                requestBody: {
                  content: { "application/json": { schema: { $ref: "#/components/schemas/L" } } },
                },
              },
            },
            "/restate/call/Widgets/{key}/launch/send": { post: {} },
          },
          components: { schemas: { L: SCHEMA } },
        };
  const ran: Record<string, unknown>[] = [];
  const db = {
    transaction: (fn: (tx: unknown) => unknown) => fn(db),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        ran.push(v);
        return { returning: async () => [{ id: v.id }] };
      },
    }),
  } as unknown as Db;
  const calls = consoleApi({ main: db, views: [], adminGet: get });
  const all = handlersOf(SERVICES);
  const ask = { viewer: operator, service: "Tally", handler: "count", input: { limit: 2 } };

  it("reads kind, public, effect and form from /services", () => {
    expect(all.find((h) => h.handler === "launch")).toEqual({
      service: "Widgets",
      handler: "launch",
      kind: "object",
      public: true,
      effect: "spends",
      form: true,
      viewer: false,
    });
    expect(all.find((h) => h.handler === "approve")?.viewer).toBe(true);
    expect(all.filter((h) => !h.public).map((h) => `${h.service}/${h.handler}`)).toEqual([
      "Widgets/loop",
      "Hidden/any",
    ]);
  });

  it("lists public handlers outside the Portals, with the input schema on the detail", async () => {
    const [type] = await calls.recordsTypes({ viewer: operator });
    expect(type).toMatchObject({ id: "console.handler" });
    // The rows and the detail as records-serve reads them; its SQL over them needs Postgres.
    const record = handlerRecord(get);
    const rows = (await record.rows?.(db)) ?? [];
    expect(rows.map((r) => r.id).sort()).toEqual([
      "Inbox/approve",
      "Tally/count",
      "Widgets/launch",
      "Widgets/status",
    ]);
    expect(rows.find((r) => r.id === "Widgets/launch")).toMatchObject({
      needs_key: "yes",
      effect: "spends",
      form: "form",
    });
    expect(await record.load?.(db, "Widgets/launch")).toEqual({
      input: SCHEMA,
      form: [{ field: "limit", label: "Limit", type: "number", optional: true }],
    });
    expect(inputSchemaOf(await get("/services/Widgets/openapi"), "Widgets", "status")).toBeNull();
  });

  it("refuses anyone but the operator, a Portal, a private or unknown handler", async () => {
    for (const viewer of [{ demo: true as const }, { email: "amy@acme.test" }])
      expect(() => calls.reader({ ...ask, viewer })).toThrow(PortalRefusal);
    expect(() => calls.reader({ ...ask, asClient: true })).toThrow(PortalRefusal);
    expect(() => consoleApi({ main, views: [] }).reader(ask)).toThrow("no Restate admin URL");
    const status = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as PortalRefusal).status;
      }
      return 200;
    };
    expect(
      status(() => calls.target({ ...ask, service: "WidgetsPortal", handler: "view" }, all)),
    ).toBe(403);
    expect(
      status(() => calls.target({ ...ask, service: "Widgets", handler: "loop", key: "a" }, all)),
    ).toBe(403);
    expect(status(() => calls.target({ ...ask, service: "Hidden", handler: "any" }, all))).toBe(
      403,
    );
    expect(status(() => calls.target({ ...ask, handler: "nope" }, all))).toBe(404);
    expect(status(() => calls.target(ask, all))).toBe(200);
  });

  it("asks a key for an object only, and the name typed in for an effect", () => {
    const launch = { ...ask, service: "Widgets", handler: "launch" };
    expect(() => calls.target(launch, all)).toThrow("say the key");
    expect(() => calls.target({ ...ask, key: "a" }, all)).toThrow("a service takes no key");
    expect(() => calls.target({ ...launch, key: "a" }, all)).toThrow("it spends: type launch");
    expect(calls.target({ ...launch, key: "a", confirm: "launch" }, all).effect).toBe("spends");
  });

  it("opens a runs row with the command, who and the input", async () => {
    const h = calls.target(ask, all);
    await calls.openCall(ask, h);
    expect(ran.at(-1)).toMatchObject({
      command: "console Tally/count",
      argv: { by: "op@example.test", input: { limit: 2 } },
      niche: null,
    });
  });
});

describe("ConsolePortal.call", () => {
  const ran: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        ran.push({ open: v });
        return { returning: async () => [{ id: "run-1" }] };
      },
    }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
    update: () => ({ set: (v: unknown) => ({ where: async () => ran.push({ close: v }) }) }),
  } as unknown as Db;
  const portal = makeConsolePortal({ main: db, views: [], adminGet: async () => SERVICES });
  const call = (
    portal as unknown as { service: Record<string, (c: unknown, r: unknown) => Promise<unknown>> }
  ).service.call;
  const sent: unknown[] = [];
  const ctxOf = (answer: () => Promise<unknown>) => ({
    run: (_: string, fn: () => unknown) => fn(),
    genericCall: (opts: unknown) => {
      sent.push(opts);
      return answer();
    },
  });

  it("refuses before any call, and calls the handler as one runs row", async () => {
    const ctx = ctxOf(async () => ({ counted: 2 }));
    const ask = { viewer: operator, service: "Tally", handler: "count", input: { limit: 2 } };
    await expect(call?.(ctx, { ...ask, viewer: { email: "amy@acme.test" } })).rejects.toThrow();
    await expect(
      call?.(ctx, { ...ask, service: "WidgetsPortal", handler: "view" }),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
    expect(await call?.(ctx, ask)).toEqual({ counted: 2 });
    expect(sent).toMatchObject([{ service: "Tally", method: "count", parameter: { limit: 2 } }]);
    expect(ran).toMatchObject([
      { open: { command: "console Tally/count", argv: { by: "op@example.test" } } },
      { close: { stats: { ok: true } } },
    ]);
  });

  it("fills a portal handler's viewer with the operator, whatever the input says", async () => {
    sent.length = 0;
    const ctx = ctxOf(async () => ({ ok: true }));
    const input = { id: 7, viewer: { email: "someone@else.test" } };
    await call?.(ctx, { viewer: operator, service: "Inbox", handler: "approve", input });
    expect(sent).toMatchObject([{ parameter: { id: 7, viewer: operator } }]);
  });

  it("closes the row with the error when the handler refuses", async () => {
    ran.length = 0;
    const ctx = ctxOf(async () => {
      throw new TerminalError("bad input");
    });
    const ask = { viewer: operator, service: "Tally", handler: "count", input: {} };
    await expect(call?.(ctx, ask)).rejects.toThrow("bad input");
    expect(ran.at(-1)).toMatchObject({ close: { stats: { error: "bad input" } } });
  });
});

describe("restateAdminGet", () => {
  it("keeps each path 5 minutes, and never a failure", async () => {
    let t = 0;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const get = restateAdminGet("https://admin.example.test/", "tok", () => t);
    await expect(get("/services")).rejects.toThrow("503");
    await get("/services");
    await get("/services");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://admin.example.test/services");
    t = 5 * 60_000;
    fetch.mockResolvedValue(new Response("{}"));
    await get("/services");
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });
});

describe("formOf: a schema as form boxes", () => {
  it("maps each type in the doc's table, nested fields as parent.child", () => {
    const schema = {
      anyOf: [
        {
          type: "object",
          properties: {
            day: { type: "string", format: "date" },
            site: { anyOf: [{ type: "string", format: "uri" }, { type: "null" }] },
            note: { type: "string", description: "said under the box" },
            openersPerDay: { type: ["number", "null"] },
            dryRun: { type: "boolean" },
            policy: { type: "string", enum: ["skip", "recheck"] },
            ids: { type: "array", items: { type: "string" } },
            recheck: {
              type: "object",
              properties: { olderThanDays: { type: "integer", title: "Days" } },
              required: ["olderThanDays"],
            },
            extra: {},
          },
          required: ["day", "site", "policy"],
        },
        { type: "null" },
      ],
    };
    expect(formOf(schema)).toEqual([
      { field: "day", label: "Day", type: "date" },
      { field: "site", label: "Site", type: "url", optional: true },
      { field: "note", label: "Note", optional: true, hint: "said under the box" },
      { field: "openersPerDay", label: "Openers per day", type: "number", optional: true },
      { field: "dryRun", label: "Dry run", type: "switch", optional: true },
      { field: "policy", label: "Policy", type: "select", options: ["skip", "recheck"] },
      { field: "ids", label: "Ids", type: "lines", optional: true },
      { field: "recheck.olderThanDays", label: "Recheck.Days", type: "number", optional: true },
      { field: "extra", label: "Extra", type: "json", optional: true },
    ]);
  });

  it("no schema, or an object with no fields, is the JSON box", () => {
    expect(formOf(null)).toBeNull();
    expect(formOf({})).toBeNull();
    expect(formOf({ type: "object", properties: {}, additionalProperties: {} })).toEqual([]);
  });

  it("never asks for the viewer: call fills it", () => {
    expect(formOf(ASKS)?.map((f) => f.field)).toEqual(["id"]);
  });
});
