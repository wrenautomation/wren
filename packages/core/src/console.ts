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
 *
 * `setLook` stores a client's portal look: an operator's for any client, an owner's for their own.
 *
 * Components (`./components.ts`): the catalog is `console.component`, every one for the team and
 * what a client can have for anyone else. `install`, `configure` and `uninstall` write a client's
 * `clients.products[id]`, operator only, each a runs row; `ask` is a client's "Ask for this".
 */
import * as restate from "@restatedev/restate-sdk";
import { CLIENT_ID, type Db, serializable, setAuditActor, snapshot } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { addClient, type Client, clients, isOwner, updateClient } from "./clients/index.js";
import type { Component, LoopKey } from "./components.js";
import {
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
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

export interface SetLookRequest extends PortalRequest {
  /** A preset's name, `readTheme` input, or null for Wren's. */
  look: unknown;
}

export interface ComponentRequest extends PortalRequest {
  component: string;
}
export interface InstallRequest extends ComponentRequest {
  settings?: unknown;
  /** The component's id, typed in when it has effects. */
  confirm?: string;
}

/** A stored look stays small: inputs, not tokens. */
const LOOK_MAX = 4000;

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
  type?: "long" | "date" | "url" | "number" | "switch" | "select" | "lines" | "numbers" | "json";
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
      // A nested box reads "Stages: research", never "Stages.Research".
      const at = label ? `${label}: ${own.charAt(0).toLowerCase()}${own.slice(1)}` : own;
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
              : s.type === "array" && item === "string"
                ? "lines"
                : s.type === "array" && (item === "number" || item === "integer")
                  ? "numbers"
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

const has = (client: Pick<Client, "products">, id: string) => Object.hasOwn(client.products, id);

/** What `client` still lacks for `c`: components not installed, then accounts not set. */
export const lacking = (c: Component, client: Pick<Client, "products" | "accounts">): string[] => [
  ...c.requires.components.filter((id) => !has(client, id)),
  ...c.requires.accounts.filter((site) => !client.accounts[site]),
];

/** A settings block as a page may show it: defaults filled, prices left out; null if it won't parse. */
export function shownSettings(c: Component, block: unknown): Record<string, unknown> | null {
  const out = c.settings.safeParse(block ?? {});
  if (!out.success || typeof out.data !== "object" || out.data === null) return null;
  const shown = { ...(out.data as Record<string, unknown>) };
  for (const k of c.priced) delete shown[k];
  return shown;
}

/** A component's settings as form boxes, prices left out. */
export function settingsForm(c: Component): HandlerField[] | null {
  const schema = z.toJSONSchema(c.settings, { io: "input", unrepresentable: "any" }) as Schema;
  const properties = { ...schema.properties };
  for (const k of c.priced) delete properties[k];
  return formOf({ ...schema, properties });
}

const COMPONENT = "console.component";

/**
 * The catalog: `all` as records, each marked installed or not for `client` when there is one.
 * The team's detail adds what it provides and its settings form, filled from the client's block.
 */
export const componentRecord = (
  all: readonly Component[],
  client: Client | null,
  team: boolean,
): RecordType =>
  defineRecord({
    id: COMPONENT,
    name: { one: "component", many: "components" },
    rows: async () =>
      all.map((c) => ({
        id: c.id,
        name: c.name,
        blurb: c.blurb,
        for: c.for,
        ready: c.ready ? "ready" : "coming",
        installed: client ? (has(client, c.id) ? "yes" : "no") : null,
        effects: c.effects.join(", ") || null,
        needs: [...c.requires.components, ...c.requires.accounts].join(", ") || null,
        missing: c.missing.join("; ") || null,
      })),
    key: "id",
    title: "name",
    subtitle: "blurb",
    fields: {
      name: text("Component"),
      blurb: text("What it does"),
      for: status(
        {
          client: { label: "For clients", tone: "neutral" },
          wren: { label: "Wren's own", tone: "neutral" },
        },
        "For",
      ),
      ready: status(
        { ready: { label: "Ready", tone: "good" }, coming: { label: "Coming", tone: "neutral" } },
        "Ready",
      ),
      installed: status(
        {
          yes: { label: "Installed", tone: "good" },
          no: { label: "Not installed", tone: "neutral" },
        },
        "Installed",
      ),
      effects: text("Effects"),
      needs: text("Needs"),
      missing: text("Missing"),
    },
    views: [
      { id: "all", label: "All", sort: "name" },
      { id: "ready", label: "Ready", where: { ready: "ready" }, sort: "name" },
      { id: "coming", label: "Coming", where: { ready: "coming" }, sort: "name" },
      ...(client
        ? [{ id: "installed", label: "Installed", where: { installed: "yes" }, sort: "name" }]
        : []),
      { id: "effects", label: "With effects", where: { effects: { empty: false } }, sort: "name" },
    ],
    load: async (_db, id) => {
      const c = all.find((x) => x.id === id);
      if (!c) return null;
      const name = (id: string) => all.find((x) => x.id === id)?.name ?? id;
      const installed = !!client && has(client, c.id);
      return {
        needs: [
          ...c.requires.components.map((id) => ({
            label: name(id),
            has: client ? has(client, id) : null,
          })),
          ...c.requires.accounts.map((site) => ({
            label: `A ${site} account`,
            has: client ? !!client.accounts[site] : null,
          })),
        ],
        effects: c.effects,
        installed,
        ...(team
          ? {
              provides: c.provides,
              form: settingsForm(c),
              values: shownSettings(c, installed ? client?.products[c.id] : {}),
            }
          : {}),
      };
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
  components = [],
  asked,
  bound = () => true,
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
  /** Every component, for the catalog and installs (`COMPONENTS` in the worker). */
  components?: readonly Component[];
  /** A client's person asked for `c`: tell Wren. Absent, `ask` refuses. */
  asked?: ((client: Client, by: string, c: Component) => Promise<void>) | undefined;
  /** Whether this worker binds `service`: a component's loop on one it doesn't is skipped. */
  bound?: ((service: string) => boolean) | undefined;
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
  /**
   * The team's types and the catalog, or the catalog alone for anyone else: what a client can
   * have, marked installed for the client picked.
   */
  const typesFor = async (req: PortalRequest): Promise<RecordType[]> => {
    const internal = seesInternal(req);
    const client = req.client || !internal ? await pickClient(main, req) : null;
    const shown = internal ? components : components.filter((c) => c.for === "client");
    return [...(internal ? types : []), componentRecord(shown, client, internal)];
  };
  /** Records on the main database, read-only, unmasked: the team sees everything. */
  const read = async <T>(
    req: PortalRequest & { record?: unknown },
    use: (api: RecordsApi) => Promise<T>,
  ): Promise<T> => {
    if (req.record !== COMPONENT) team(req);
    const all = await typesFor(req);
    return snapshot(main, (tx) => use(serveRecords(all, tx)));
  };
  const componentOf = (req: ComponentRequest): Component => {
    const c = components.find((x) => x.id === req.component);
    if (!c) throw new PortalRefusal("no such component", 404);
    return c;
  };
  /** A block that parses as `c`'s settings, or a 400 that says where it doesn't. */
  const blockOf = (c: Component, block: unknown): Record<string, unknown> => {
    if (block === undefined) return {};
    if (!block || typeof block !== "object" || Array.isArray(block))
      throw new PortalRefusal("settings are an object", 400);
    const out = c.settings.safeParse(block);
    if (!out.success)
      throw new PortalRefusal(
        `settings: ${out.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
        400,
      );
    return block as Record<string, unknown>;
  };
  /**
   * One change to a client's components, by an operator, checked first and then a runs row:
   * the block written, or null to remove it.
   */
  const change = async (
    req: ComponentRequest,
    verb: "install" | "configure" | "uninstall",
    check: (c: Component, client: Client) => Record<string, unknown> | null,
  ) => {
    team(req);
    const c = componentOf(req);
    // An operator may pick any client, the demo too: its apps come from its components.
    const client = await pickClient(main, req);
    const block = check(c, client);
    const by = (req.viewer as SignedViewer).email;
    const run = await openRun(main, {
      command: `console ${verb} ${c.id}`.slice(0, 64),
      argv: { by, client: client.id, ...(block ? { settings: block } : {}) },
    });
    try {
      await serializable(main, async (tx) => {
        await setAuditActor(tx, by);
        await updateClient(tx, client.id, { products: { [c.id]: block } });
      });
    } catch (err) {
      await finishRun(main, run.id, { error: String(err).slice(0, 500) });
      throw err;
    }
    await finishRun(main, run.id, { ok: true });
    // Every loop the new block lists starts (a running one ignores it); the ones it dropped stop.
    const loopsOf = (b: unknown): LoopKey[] => {
      // A hand-edited old block that no longer parses names no loops.
      const parsed = b === undefined || b === null ? null : c.settings.safeParse(b);
      return parsed?.success
        ? c.clientLoops(client.id, parsed.data as Record<string, unknown>)
        : [];
    };
    const id = (l: LoopKey) => `${l.service} ${l.key}`;
    const start = loopsOf(block).filter((l) => bound(l.service));
    const kept = new Set(start.map(id));
    const stop = loopsOf(client.products[c.id]).filter((l) => bound(l.service) && !kept.has(id(l)));
    return { client: client.id, component: c.id, installed: block !== null, start, stop };
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

    recordsTypes: async (req: PortalRequest): Promise<RecordMeta[]> =>
      (await typesFor(req)).map((t) => metaOf(t, false)),
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

    /** Checked here, read by `readTheme` in the browser, which drops what it can't use. */
    async setLook(req: SetLookRequest): Promise<{ client: string; look: unknown }> {
      const viewer = req.viewer;
      if (isDemo(viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const look = req.look;
      const shape = look === null || typeof look === "string" || typeof look === "object";
      if (!shape || Array.isArray(look) || JSON.stringify(look).length > LOOK_MAX)
        throw new PortalRefusal("a look is a preset's name or an object of tokens", 400);
      // An operator may pick any client; anyone else only their own.
      const client = await pickClient(main, req);
      if (!viewer.operator && !(await isOwner(main, client.id, viewer.email)))
        throw new PortalRefusal("only an owner of this account can do that", 403);
      await serializable(main, async (tx) => {
        await setAuditActor(tx, viewer.email);
        await tx.update(clients).set({ look }).where(eq(clients.id, client.id));
      });
      return { client: client.id, look };
    },

    /**
     * A component onto a client: ready, for clients, what it needs already there, settings that
     * parse, and its id typed in when it has effects. The block is stored as given.
     */
    install: (req: InstallRequest) =>
      change(req, "install", (c, client) => {
        if (c.for === "wren") throw new PortalRefusal("that runs Wren's own business", 409);
        if (!c.ready)
          throw new PortalRefusal(`not ready for a client: ${c.missing.join("; ")}`, 409);
        if (has(client, c.id)) throw new PortalRefusal("already installed: configure it", 409);
        const lacks = lacking(c, client);
        if (lacks.length) throw new PortalRefusal(`needs first: ${lacks.join(", ")}`, 409);
        if (c.effects.length && req.confirm !== c.id)
          throw new PortalRefusal(`it ${c.effects.join(" and ")}: type ${c.id} to confirm`, 400);
        return blockOf(c, req.settings);
      }),
    /** New settings over the old: a field left out keeps its value (a price is never sent). */
    configure: (req: InstallRequest) =>
      change(req, "configure", (c, client) => {
        if (!has(client, c.id)) throw new PortalRefusal("not installed", 404);
        const old = client.products[c.id];
        const merged = {
          ...(old && typeof old === "object" ? old : {}),
          ...blockOf(c, req.settings),
        };
        return blockOf(c, merged);
      }),
    /** Off the client; its data stays in the client's database. Refused while another needs it. */
    uninstall: (req: ComponentRequest) =>
      change(req, "uninstall", (c, client) => {
        if (!has(client, c.id)) throw new PortalRefusal("not installed", 404);
        const users = components.filter(
          (o) => has(client, o.id) && o.requires.components.includes(c.id),
        );
        if (users.length)
          throw new PortalRefusal(
            `${users.map((o) => o.name).join(", ")} need${users.length === 1 ? "s" : ""} it: uninstall that first`,
            409,
          );
        return null;
      }),
    /** A client's person asks for a component; installing it stays Wren's call. */
    async ask(req: ComponentRequest): Promise<{ component: string }> {
      if (seesInternal(req)) throw new PortalRefusal("the team installs it instead", 403);
      const { client, viewer } = await pickForWrite(main, req);
      const c = componentOf(req);
      if (c.for !== "client") throw new PortalRefusal("no such component", 404);
      if (has(client, c.id)) throw new PortalRefusal("you have it already", 409);
      if (!asked) throw new PortalRefusal("asking isn't set up here", 503);
      await asked(client, viewer.email, c);
      return { component: c.id };
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

/**
 * A component change, journaled so a replay never installs twice, then its loops: the ones
 * its block lists started, the ones it dropped stopped. The sends land after the answer.
 */
async function changeLoops(
  ctx: restate.Context,
  verb: string,
  change: () => Promise<{ start: LoopKey[]; stop: LoopKey[] }>,
) {
  const out = await ctx.run(verb, () => answer(change));
  for (const l of out.start) ctx.objectSendClient<LoopControl>({ name: l.service }, l.key).start();
  for (const l of out.stop) ctx.objectSendClient<LoopControl>({ name: l.service }, l.key).stop();
  return out;
}

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
      setLook: (_: restate.Context, req: SetLookRequest) => answer(() => api.setLook(req)),
      install: (ctx: restate.Context, req: InstallRequest) =>
        changeLoops(ctx, "install", () => api.install(req)),
      configure: (ctx: restate.Context, req: InstallRequest) =>
        changeLoops(ctx, "configure", () => api.configure(req)),
      uninstall: (ctx: restate.Context, req: ComponentRequest) =>
        changeLoops(ctx, "uninstall", () => api.uninstall(req)),
      ask: (_: restate.Context, req: ComponentRequest) => answer(() => api.ask(req)),
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
