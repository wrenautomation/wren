/**
 * ConsolePortal: Wren's team reads a view by name, as JSON or CSV. A portal card, a CSV export
 * and an agent read the same answer. Each package says which of its views it allows; the worker
 * passes the lists in, so core never names a product's view.
 *
 * Loops are core's: `loops` lists every object with a `running` key from Restate's admin SQL,
 * so a loop added later shows up with no list to update, and `setLoop` stops or starts one.
 *
 * Records (`./records.ts`) for the team: each package passes its types in, as with views, and
 * the loops ride along as one more type, `console.loop`, read from Restate instead of a view.
 *
 * `addClient` makes a client from the console: its database, migrated, then its row. Its people
 * are added after with DeliveryPortal's `invite` (`delivery.invite`), as anywhere else.
 */
import * as restate from "@restatedev/restate-sdk";
import { CLIENT_ID, type Db } from "@wren/db";
import { sql } from "drizzle-orm";
import { addClient } from "./clients/index.js";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  type SignedViewer,
  seesInternal,
} from "./portal.js";
import {
  date,
  defineRecord,
  metaOf,
  number,
  type RecordMeta,
  type RecordType,
  status,
  text,
} from "./records.js";
import {
  type ExportAsk,
  type GetAsk,
  type ListAsk,
  type RecordAnswer,
  type RecordsApi,
  type RecordsCsv,
  type RecordsPage,
  type RecordsStat,
  type StatsAsk,
  serveRecords,
  toCsv,
} from "./records-serve.js";
import type { PassOutcome } from "./restate/loop.js";
import { finishRun, openRun } from "./runs.js";

export { toCsv };

export interface ViewRequest extends PortalRequest {
  view: string;
  format?: "json" | "csv";
}
export type Cell = string | number | boolean | null;
export interface ViewTable {
  view: string;
  columns: string[];
  rows: Cell[][];
}
export type ViewAnswer = ViewTable | { view: string; csv: string };

// ponytail: a hard cap, no paging. Allowed views are aggregates; page when one isn't.
const MAX_ROWS = 5000;
/** Postgres int8 and numeric arrive as strings; counts and rates read as numbers. */
const NUMERIC_TYPES = new Set([20, 1700]);

const cellOf = (v: unknown, numeric: boolean): Cell => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (numeric) return Number(v);
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return JSON.stringify(v);
};

type Rows = Record<string, unknown>[] & { columns?: { name: string; type: number }[] };

/** One loop object: a key of a service whose state has `running`. */
export interface LoopRow {
  service: string;
  key: string;
  running: boolean;
  /** When the last pass ran; null before the first. */
  lastAt: string | null;
  /** Failed passes in a row; 0 when the last one went fine. */
  failures: number;
  error: string | null;
  /** When the next `loop` call is due; null when none is queued. */
  nextAt: string | null;
}
export interface SetLoopRequest extends PortalRequest {
  service: string;
  key: string;
  /** true starts it (stored settings kept), false stops it after the pass in flight. */
  run: boolean;
}

/** SQL over Restate's own tables, through its admin API. */
export interface AddClientRequest extends PortalRequest {
  id: string;
  name: string;
}

export interface CallRequest extends PortalRequest {
  service: string;
  handler: string;
  /** The object's or workflow's key; a plain service takes none. */
  key?: string;
  input?: unknown;
  /** The handler's name typed in: a handler with an effect runs only with it. */
  confirm?: string;
}

export type RestateAdmin = (query: string) => Promise<Record<string, unknown>[]>;
/** A GET on Restate's admin API: `/services`, `/services/<name>/openapi`. */
export type RestateAdminGet = (path: string) => Promise<unknown>;

const ADMIN_CACHE_MS = 5 * 60_000;

/** GETs on the admin API, each path kept 5 minutes: the list changes only on a deploy. */
export const restateAdminGet = (
  url: string,
  token?: string,
  now: () => number = Date.now,
): RestateAdminGet => {
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  return (path) => {
    const hit = cache.get(path);
    if (hit && now() - hit.at < ADMIN_CACHE_MS) return hit.value;
    const value = fetch(`${url.replace(/\/$/, "")}${path}`, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        accept: "application/json",
      },
    }).then(async (res) => {
      if (!res.ok) throw new Error(`restate admin GET ${path}: ${res.status} ${await res.text()}`);
      return res.json();
    });
    // A failed read is not kept: the next ask tries again.
    value.catch(() => cache.delete(path));
    cache.set(path, { at: now(), value });
    return value;
  };
};

export const restateAdmin =
  (url: string, token?: string): RestateAdmin =>
  async (query) => {
    const res = await fetch(`${url.replace(/\/$/, "")}/query`, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`restate admin query: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { rows: Record<string, unknown>[] }).rows;
  };

/** `scheduled_at` rides along: without it Restate leaves `scheduled_start_at` out of the answer. */
const LOOPS_SQL = `SELECT s.service_name, s.service_key, s.key, s.value_utf8, i.scheduled_at, i.scheduled_start_at
FROM state s
LEFT JOIN sys_invocation i ON i.target_service_name = s.service_name AND i.target_service_key = s.service_key
  AND i.target_handler_name = 'loop' AND i.status = 'scheduled'
WHERE s.key IN ('running', 'last')`;

/** One row per object with a `running` key, failing first, then by name. */
export function loopsOf(rows: Record<string, unknown>[]): LoopRow[] {
  const objects = new Map<string, { state: Record<string, unknown>; next: string | null }>();
  for (const r of rows) {
    const id = `${r.service_name}/${r.service_key}`;
    const o = objects.get(id) ?? { state: {}, next: null };
    o.state[String(r.key)] = JSON.parse(String(r.value_utf8));
    const at = r.scheduled_start_at;
    if (typeof at === "string" && (o.next === null || at < o.next)) o.next = at;
    objects.set(id, o);
  }
  const loops: LoopRow[] = [];
  for (const [id, { state, next }] of objects) {
    if (!("running" in state)) continue;
    const slash = id.indexOf("/");
    const last = (state.last ?? null) as Partial<PassOutcome<unknown>> | null;
    loops.push({
      service: id.slice(0, slash),
      key: id.slice(slash + 1),
      running: state.running === true,
      lastAt: last?.now ?? null,
      failures: last?.failures ?? 0,
      error: last?.error ?? null,
      nextAt: next,
    });
  }
  const failing = (l: LoopRow) => (l.failures > 0 || l.error !== null ? 0 : 1);
  return loops.sort(
    (a, b) =>
      failing(a) - failing(b) || a.service.localeCompare(b.service) || a.key.localeCompare(b.key),
  );
}

/**
 * Every loop as a record. Its id is "<service>/<key>"; `console.startLoop` and
 * `console.stopLoop` call `setLoop` with its service and key.
 */
export const loopRecord = (admin: RestateAdmin): RecordType =>
  defineRecord({
    id: "console.loop",
    name: { one: "loop", many: "loops" },
    rows: async () =>
      loopsOf(await admin(LOOPS_SQL)).map((l) => ({
        id: `${l.service}/${l.key}`,
        service: l.service,
        key: l.key,
        state: l.running ? "running" : "stopped",
        // A stopped loop keeps its old failure count; only a running one is failing.
        health: l.running && (l.failures > 0 || l.error !== null) ? "failing" : "ok",
        last_at: l.lastAt,
        failures: l.failures,
        error: l.error,
        next_at: l.nextAt,
      })),
    key: "id",
    title: "service",
    subtitle: "key",
    fields: {
      service: text("Loop"),
      key: text("Key"),
      state: status({
        running: { label: "Running", tone: "good" },
        stopped: { label: "Stopped", tone: "neutral" },
      }),
      health: status({
        failing: { label: "Failing", tone: "bad" },
        ok: { label: "OK", tone: "good" },
      }),
      lastAt: date("Last pass"),
      failures: number("Failures in a row"),
      error: text("Last error"),
      nextAt: date("Next pass"),
    },
    views: [
      { id: "all", label: "All", sort: "health", at: "lastAt" },
      { id: "failing", label: "Failing", where: { health: "failing" }, sort: "-failures" },
      { id: "stopped", label: "Stopped", where: { state: "stopped" } },
    ],
    actions: ["console.startLoop", "console.stopLoop"],
  });

/** One handler as `/services` tells it. */
export interface HandlerRow {
  service: string;
  handler: string;
  kind: "service" | "object" | "workflow";
  /** Callable from outside: the service and the handler are both public. */
  public: boolean;
  effect: string | null;
  /** It declares an input schema, so it opens to a form. */
  form: boolean;
  /** Its input takes a portal `viewer`, which `call` fills with the operator. */
  viewer: boolean;
}

const KIND_OF: Record<string, HandlerRow["kind"]> = {
  Service: "service",
  VirtualObject: "object",
  Workflow: "workflow",
};

/** `*Portal` services are the apps' own backends: their pages are their form. */
const isPortal = (service: string) => service.endsWith("Portal");

export function handlersOf(services: unknown): HandlerRow[] {
  type H = {
    name: string;
    public?: boolean;
    metadata?: Record<string, string>;
    input_json_schema?: unknown;
  };
  type S = { name: string; ty: string; public?: boolean; handlers: H[] };
  const list = (services as { services?: S[] }).services ?? [];
  return list.flatMap((s) =>
    s.handlers.map((h) => ({
      service: s.name,
      handler: h.name,
      kind: KIND_OF[s.ty] ?? "service",
      public: s.public !== false && h.public !== false,
      effect: h.metadata?.effect ?? null,
      form: h.input_json_schema !== undefined,
      viewer: (h.input_json_schema as Schema | undefined)?.properties?.viewer !== undefined,
    })),
  );
}

/** The handler's input schema from the service's OpenAPI; null when it declares none. */
export function inputSchemaOf(openapi: unknown, service: string, handler: string): unknown {
  type Doc = {
    paths?: Record<
      string,
      { post?: { requestBody?: { content?: Record<string, { schema?: unknown }> } } }
    >;
    components?: { schemas?: Record<string, unknown> };
  };
  const doc = openapi as Doc;
  const call = `/restate/call/${service}/`;
  const path = Object.keys(doc.paths ?? {}).find(
    (p) =>
      p.startsWith(call) &&
      p.endsWith(`/${handler}`) &&
      !p.slice(call.length).includes("/{idempotencyKey}"),
  );
  const schema = path
    ? doc.paths?.[path]?.post?.requestBody?.content?.["application/json"]?.schema
    : undefined;
  const ref = (schema as { $ref?: string } | undefined)?.$ref;
  if (ref?.startsWith("#/components/schemas/"))
    return doc.components?.schemas?.[ref.slice("#/components/schemas/".length)] ?? null;
  return schema ?? null;
}

/** One box of a handler's form; `type` left out is a line of text, as in the ui's `FormField`. */
export interface HandlerField {
  /** Its path in the input: `parent.child` for a nested field. */
  field: string;
  label: string;
  type?: "long" | "date" | "url" | "number" | "switch" | "select" | "lines" | "json";
  optional?: true;
  hint?: string;
  /** A select's choices. */
  options?: readonly string[];
}

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  enum?: unknown[];
  items?: Schema;
  format?: string;
  title?: string;
  description?: string;
};

/** "openersPerDay" → "Openers per day". */
const words = (name: string) => {
  const w = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** Drops a `null` branch: a nullable field is an optional one. */
const nonNull = (s: Schema): Schema => {
  const branches = s.anyOf?.filter((b) => b.type !== "null");
  if (branches?.length === 1 && branches[0]) return branches[0];
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== "null");
    if (types.length === 1) return { ...s, type: types[0] as string };
  }
  return s;
};

/**
 * A handler's input schema as form boxes, per the doc's table; null when it declares no
 * fields (the JSON box). Anything the table doesn't name is a JSON box for that field.
 */
export function formOf(input: unknown): HandlerField[] | null {
  const root = nonNull((input ?? {}) as Schema);
  if (root.type !== "object" || !root.properties) return null;
  const out: HandlerField[] = [];
  const walk = (obj: Schema, path: string, label: string, parentOptional: boolean) => {
    for (const [name, raw] of Object.entries(obj.properties ?? {})) {
      // `call` fills a portal handler's viewer with the operator; the form never asks for it.
      if (!path && name === "viewer") continue;
      const s = nonNull(raw);
      const field = path ? `${path}.${name}` : name;
      const own = s.title ?? words(name);
      const at = label ? `${label}.${own}` : own;
      const optional = parentOptional || !obj.required?.includes(name) || s !== raw;
      if (s.type === "object" && s.properties && Object.keys(s.properties).length) {
        walk(s, field, at, optional);
        continue;
      }
      const item = s.items?.type;
      const type: HandlerField["type"] | undefined = s.enum
        ? "select"
        : s.type === "string"
          ? s.format === "date"
            ? "date"
            : s.format === "uri"
              ? "url"
              : undefined
          : s.type === "number" || s.type === "integer"
            ? "number"
            : s.type === "boolean"
              ? "switch"
              : s.type === "array" && (item === "string" || item === "number" || item === "integer")
                ? "lines"
                : "json";
      out.push({
        field,
        label: at,
        ...(type ? { type } : {}),
        ...(optional ? { optional: true as const } : {}),
        ...(s.description ? { hint: s.description } : {}),
        ...(s.enum ? { options: s.enum.map(String) } : {}),
      });
    }
  };
  walk(root, "", "", false);
  return out;
}

/**
 * Every handler a form can call, as a record: public ones outside the `*Portal` services.
 * Its id is "<service>/<handler>"; the detail carries the input schema from the OpenAPI.
 */
export const handlerRecord = (get: RestateAdminGet): RecordType =>
  defineRecord({
    id: "console.handler",
    name: { one: "handler", many: "handlers" },
    rows: async () =>
      handlersOf(await get("/services"))
        .filter((h) => h.public && !isPortal(h.service))
        .map((h) => ({
          id: `${h.service}/${h.handler}`,
          service: h.service,
          handler: h.handler,
          kind: h.kind,
          needs_key: h.kind === "service" ? "no" : "yes",
          effect: h.effect,
          form: h.form ? "form" : "json",
        })),
    key: "id",
    title: "handler",
    subtitle: "service",
    fields: {
      service: text("Service"),
      handler: text("Handler"),
      kind: status({
        service: { label: "Service", tone: "neutral" },
        object: { label: "Object", tone: "neutral" },
        workflow: { label: "Workflow", tone: "neutral" },
      }),
      needsKey: status(
        { yes: { label: "Asks a key", tone: "neutral" }, no: { label: "No key", tone: "neutral" } },
        "Key",
      ),
      effect: status(
        {
          spends: { label: "Spends", tone: "bad" },
          sends: { label: "Sends", tone: "warn" },
          posts: { label: "Posts", tone: "warn" },
        },
        "Effect",
      ),
      form: status(
        { form: { label: "Form", tone: "good" }, json: { label: "JSON box", tone: "neutral" } },
        "Input",
      ),
    },
    views: [
      { id: "all", label: "All", sort: "service" },
      { id: "forms", label: "With a form", where: { form: "form" }, sort: "service" },
      {
        id: "effects",
        label: "Effects",
        where: { effect: ["spends", "sends", "posts"] },
        sort: "service",
      },
    ],
    load: async (_db, id) => {
      const slash = id.indexOf("/");
      if (slash < 0) return null;
      const service = id.slice(0, slash);
      const openapi = await get(`/services/${encodeURIComponent(service)}/openapi`);
      const input = inputSchemaOf(openapi, service, id.slice(slash + 1));
      return { input, form: formOf(input) };
    },
  });

/** The runs row's command: one line on the run trail, as a CLI command would be. */
export const callCommand = (service: string, handler: string) =>
  `console ${service}/${handler}`.slice(0, 64);

export function consoleApi({
  main,
  views,
  admin,
  adminGet,
  records = [],
  mainUrl,
}: {
  main: Db;
  /** The main database's URL, which `addClient` needs to reach the new one; absent, it refuses. */
  mainUrl?: string | undefined;
  views: readonly string[];
  /** Absent, `loops` refuses: this worker can't see Restate's state. */
  admin?: RestateAdmin | undefined;
  /** Absent, `call` refuses and there is no handler list. */
  adminGet?: RestateAdminGet | undefined;
  /** The team's record types; the loops join them when there's an admin. */
  records?: readonly RecordType[];
}) {
  const allowed = new Set(views);
  const types = [
    ...records,
    ...(admin ? [loopRecord(admin)] : []),
    ...(adminGet ? [handlerRecord(adminGet)] : []),
  ];
  const team = (req: PortalRequest) => {
    if (!seesInternal(req)) throw new PortalRefusal("that's for Wren's team", 403);
  };
  /** Records on the main database, read-only, unmasked: the team sees everything. */
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>): Promise<T> => {
    team(req);
    return main.transaction((tx) => use(serveRecords(types, tx)), { accessMode: "read only" });
  };
  /** Restate's admin for Wren's team; refused before any read, so a refusal never lands in a journaled step. */
  const adminFor = (req: PortalRequest): RestateAdmin => {
    team(req);
    if (!admin) throw new PortalRefusal("this worker has no Restate admin URL", 503);
    return admin;
  };
  return {
    adminFor,
    async view(req: ViewRequest): Promise<ViewAnswer> {
      team(req);
      if (typeof req.view !== "string" || !allowed.has(req.view))
        throw new PortalRefusal("no such view", 404);
      // "books.spend" is schema books, view spend: each part quoted on its own.
      const name = sql.join(
        req.view.split(".").map((part) => sql.identifier(part)),
        sql.raw("."),
      );
      const res = (await main.execute(
        sql`SELECT * FROM ${name} LIMIT ${MAX_ROWS}`,
      )) as unknown as Rows;
      const cols = res.columns ?? Object.keys(res[0] ?? {}).map((name) => ({ name, type: 0 }));
      const columns = cols.map((c) => c.name);
      const rows = res.map((r) => cols.map((c) => cellOf(r[c.name], NUMERIC_TYPES.has(c.type))));
      const table = { view: req.view, columns, rows };
      return req.format === "csv" ? { view: req.view, csv: toCsv(table) } : table;
    },

    loops: async (req: PortalRequest): Promise<LoopRow[]> =>
      loopsOf(await adminFor(req)(LOOPS_SQL)),

    recordsTypes: async (req: PortalRequest): Promise<RecordMeta[]> => {
      team(req);
      return types.map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk): Promise<RecordsPage> =>
      read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk): Promise<RecordAnswer> =>
      read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk): Promise<RecordsCsv> =>
      read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk): Promise<RecordsStat> =>
      read(req, (r) => r.stats(req)),

    /** A new client from `req`, checked before any step runs: team only, a plain id, a name. */
    newClient(req: AddClientRequest): { id: string; name: string; by: string } {
      team(req);
      if (!mainUrl) throw new PortalRefusal("this worker can't make databases", 503);
      const id = typeof req.id === "string" ? req.id.trim() : "";
      if (!CLIENT_ID.test(id))
        throw new PortalRefusal("id: a lowercase letter, then up to 39 of a-z, 0-9, _", 400);
      const name = typeof req.name === "string" ? req.name.trim() : "";
      if (!name || name.length > 200) throw new PortalRefusal("say the client's name", 400);
      return { id, name, by: (req.viewer as SignedViewer).email };
    },
    /** Make it, or finish a make that failed partway; a client already there comes back as it is. */
    async addClient({ id, name, by }: { id: string; name: string; by: string }) {
      if (!mainUrl) throw new PortalRefusal("this worker can't make databases", 503);
      const c = await addClient(main, mainUrl, { id, name }, by);
      return { id: c.id, name: c.name, demo: c.demo };
    },

    /** The loop `req` names, if `loops` listed it; anything else names no loop. */
    /** The read `call` journals: the handler `req` names, as a list of 0 or 1. Refused before it, as `adminFor` is. */
    reader(req: CallRequest): () => Promise<HandlerRow[]> {
      team(req);
      const get = adminGet;
      if (!get) throw new PortalRefusal("this worker has no Restate admin URL", 503);
      return async () =>
        handlersOf(await get("/services")).filter(
          (h) => h.service === req.service && h.handler === req.handler,
        );
    },
    /**
     * The handler `req` names, if a form may call it: operator only, public, not a Portal
     * backend, a key exactly when it needs one, and its name typed in when it has an effect.
     */
    target(req: CallRequest, all: readonly HandlerRow[]): HandlerRow {
      team(req);
      if (typeof req.service !== "string" || typeof req.handler !== "string")
        throw new PortalRefusal("say service and handler", 400);
      if (isPortal(req.service)) throw new PortalRefusal("a Portal's handlers are its app's", 403);
      const h = all.find((x) => x.service === req.service && x.handler === req.handler);
      if (!h) throw new PortalRefusal("no such handler", 404);
      if (!h.public) throw new PortalRefusal("that handler is never called from outside", 403);
      const keyed = h.kind !== "service";
      if (keyed !== (typeof req.key === "string" && req.key !== ""))
        throw new PortalRefusal(keyed ? "say the key" : "a service takes no key", 400);
      if (h.effect && req.confirm !== h.handler)
        throw new PortalRefusal(`it ${h.effect}: type ${h.handler} to confirm`, 400);
      return h;
    },
    /** The runs row for one call: who, what, with what. Never the answer. */
    openCall: (req: CallRequest, h: HandlerRow) =>
      openRun(main, {
        command: callCommand(h.service, h.handler),
        argv: {
          by: (req.viewer as SignedViewer).email,
          ...(req.key ? { key: req.key } : {}),
          input: req.input ?? null,
        },
      }).then((r) => r.id),
    closeCall: (runId: string, error: string | null) =>
      finishRun(main, runId, error === null ? { ok: true } : { error: error.slice(0, 500) }),

    pick(req: SetLoopRequest, loops: readonly LoopRow[]): LoopRow {
      if (typeof req.run !== "boolean") throw new PortalRefusal("say run: true or false", 400);
      const loop = loops.find((l) => l.service === req.service && l.key === req.key);
      if (!loop) throw new PortalRefusal("no such loop", 404);
      return loop;
    },
  };
}

// The SDK types `jsonSchema` as optional without `| undefined`; the json serde has it unset.
const JSON_SERDE = restate.serde.json as unknown as restate.Serde<unknown>;

/** What `setLoop` calls on any loop object; `start` with no body keeps its stored settings. */
type LoopControl = {
  start: (ctx: restate.ObjectContext) => Promise<unknown>;
  stop: (ctx: restate.ObjectContext) => Promise<unknown>;
};

export function makeConsolePortal(deps: Parameters<typeof consoleApi>[0]) {
  const api = consoleApi(deps);
  return restate.service({
    name: "ConsolePortal",
    handlers: {
      view: (_: restate.Context, req: ViewRequest) => answer(() => api.view(req)),
      loops: (_: restate.Context, req: PortalRequest) => answer(() => api.loops(req)),
      recordsTypes: (_: restate.Context, req: PortalRequest) => answer(() => api.recordsTypes(req)),
      recordsList: (_: restate.Context, req: PortalRequest & ListAsk) =>
        answer(() => api.recordsList(req)),
      recordsGet: (_: restate.Context, req: PortalRequest & GetAsk) =>
        answer(() => api.recordsGet(req)),
      recordsExport: (_: restate.Context, req: PortalRequest & ExportAsk) =>
        answer(() => api.recordsExport(req)),
      recordsStats: (_: restate.Context, req: PortalRequest & StatsAsk) =>
        answer(() => api.recordsStats(req)),
      setLoop: (ctx: restate.Context, req: SetLoopRequest) =>
        answer(async () => {
          api.adminFor(req);
          // Journaled: the call below suspends the Lambda, and the replay must find the same list.
          const loop = api.pick(req, await ctx.run("read loops", () => api.loops(req)));
          const object = ctx.objectClient<LoopControl>({ name: loop.service }, loop.key);
          await (req.run ? object.start() : object.stop());
          return { ...loop, running: req.run };
        }),
      /**
       * Any public handler, by an operator, as one durable call: the target is checked
       * against Restate's own list, and the call is a runs row with who made it.
       */
      call: (ctx: restate.Context, req: CallRequest) =>
        answer(async (): Promise<unknown> => {
          const read = api.reader(req);
          // Journaled: the call below suspends the Lambda, and the replay must find the same target.
          const h = api.target(req, await ctx.run("read handler", read));
          const runId = await ctx.run("open run", () => api.openCall(req, h));
          try {
            const out = await ctx.genericCall<unknown, unknown>({
              service: h.service,
              method: h.handler,
              ...(h.kind === "service" ? {} : { key: req.key as string }),
              // The operator is the viewer, whatever the input says.
              parameter: h.viewer ? { ...(req.input as object), viewer: req.viewer } : req.input,
              inputSerde: JSON_SERDE,
              outputSerde: JSON_SERDE,
            });
            await ctx.run("close run", () => api.closeCall(runId, null));
            return out;
          } catch (err) {
            if (err instanceof restate.TerminalError)
              await ctx.run("close run", () => api.closeCall(runId, err.message));
            throw err;
          }
        }),
      addClient: (ctx: restate.Context, req: AddClientRequest) =>
        answer(async () => {
          const ask = api.newClient(req);
          // One step: a retry after a timeout finishes the same add, and the replay reads its answer.
          const made = await ctx.run("add client", () => api.addClient(ask), {
            maxRetryAttempts: 3,
          });
          // The id was taken before this ask: same name is the same client, else a clash.
          if (made.name !== ask.name || made.demo)
            throw new PortalRefusal(`client ${ask.id} exists`, 409);
          return made;
        }),
    },
  });
}
