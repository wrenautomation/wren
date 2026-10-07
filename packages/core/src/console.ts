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
import {
  CLIENT_ID,
  type Db,
  type Queryable,
  serializable,
  setAuditActor,
  snapshot,
} from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { can, TEAM_ROLES, type TeamRole, WREN } from "./access.js";
import { ASK, type AskService, ask, type QuestionRequest } from "./ask.js";
import { release } from "./checks.js";
import {
  addClient,
  type Client,
  changeRecord,
  clients,
  isOwner,
  LastAdmin,
  normalEmail,
  removeTeamSeat,
  setTeamSeat,
  settingsFor,
  setWrenSettings,
  teamRecord,
  updateClient,
} from "./clients/index.js";
import { wrenSettings } from "./clients/schema.js";
import {
  CHANNELS,
  type Component,
  EVENT_KINDS,
  type LoopKey,
  type Port,
  STAGES,
} from "./components.js";
import { CONSOLE_ROUTES } from "./console-routes.js";
import {
  ASK_COMMAND,
  ASK_MESSAGE_MAX,
  askPrompt,
  type Edited,
  editRecord,
  undoChange,
  wordsPatch,
} from "./edits.js";
import {
  addExperiment,
  type ExperimentInput,
  experimentRecord,
  removeExperiments,
  shipExperiments,
  startExperiments,
  stopExperiments,
} from "./experiment-store.js";
import { addFlag, type EdgePush, type FlagInput, flagRecord, removeFlags } from "./flag-store.js";
import { inHouseOfPart } from "./in-house.js";
import {
  addSnippet,
  removeSnippet,
  SNIPPET,
  type SnippetInput,
  snippetRecord,
  snippetsOf,
  snippetTags,
  workflowRecord,
} from "./library.js";
import {
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalService,
  type SignedViewer,
  seesInternal,
  teamCan,
  whoIs,
} from "./portal.js";
import {
  date,
  defineRecord,
  metaOf,
  number,
  percent,
  type RecordMeta,
  type RecordType,
  status,
  tags,
  text,
  type Values,
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
import { moveViews, prefsOf, removeView, savedViewsOf, saveView, setPref } from "./saved-views.js";
import { runs, type SentEvent, workflowSaves } from "./schema.js";
import { editsOf, type SavedWorkflow, SPINE, type SpineService, savedWorkflows } from "./spine.js";
import { flowsWith, partsIn, type Workflow, type WorkflowEdits } from "./workflows.js";

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

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** A seat on Wren's team: a field left out keeps its value; `clients` null is every client. */
export interface TeamSeatRequest extends PortalRequest {
  email: string;
  role?: TeamRole;
  /** Ids, or a form's comma list; null, blank or "all" is every client. */
  clients?: string[] | string | null;
}

export interface ComponentRequest extends PortalRequest {
  component: string;
}
export interface InstallRequest extends ComponentRequest {
  settings?: unknown;
  /** The component's id, typed in when it has effects. */
  confirm?: string;
}

/** A workflow's routed wires and custom steps from the canvas; `reset` goes back to the code's. */
export interface WorkflowSaveRequest extends PortalRequest {
  workflow: string;
  wires?: unknown;
  steps?: unknown;
  reset?: boolean;
}

const NAME = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "is no id")
  .max(40);
const PORT = z.object({
  id: NAME,
  label: z.string().trim().min(1).max(60),
  kind: z.enum(Object.keys(EVENT_KINDS) as [string, ...string[]]),
});
/** What the canvas sends; unknown fields (a drawn wire's label and count) are dropped. */
const EDITS = z.object({
  wires: z
    .array(
      z.object({
        from: z.string().max(200),
        to: z.string().max(200),
        via: z.enum(["code", "events"]),
        when: z.string().trim().min(1).max(300).optional(),
        wait: z.string().trim().min(1).max(40).optional(),
      }),
    )
    .max(200),
  steps: z
    .array(
      z.object({
        id: NAME,
        note: z.string().trim().max(200).optional(),
        own: z.object({
          name: z.string().trim().min(1).max(60),
          blurb: z.string().trim().max(200),
          icon: z.string().max(40),
          in: z.array(PORT).max(8),
          out: z.array(PORT).max(8),
          run: z.string().max(500),
        }),
      }),
    )
    .max(20),
});

/** A stored look stays small: inputs, not tokens. */
const LOOK_MAX = 4000;

/** One record of Wren's that declares edits. */
interface RecordRequest extends PortalRequest {
  record?: unknown;
  id?: unknown;
}
export interface EditRequest extends RecordRequest {
  patch?: unknown;
  /** The version the editor started from (`edit.version` on the record). */
  expect?: unknown;
  /** Claude's ask whose patch this is: Accept. */
  run?: unknown;
}
export interface UndoRequest extends RecordRequest {
  change?: unknown;
}
export interface AskRequest extends RecordRequest {
  message?: unknown;
}

/** Saved views and prefs (`./saved-views.ts`): what each handler reads of it, checked there. */
export interface KeepRequest extends PortalRequest {
  record?: unknown;
  id?: unknown;
  name?: unknown;
  params?: unknown;
  shared?: unknown;
  ids?: unknown[];
  key?: unknown;
  keys?: unknown[];
  value?: unknown;
}
export interface CallRequest extends PortalRequest {
  service: string;
  handler: string;
  /** The object's or workflow's key; a plain service takes none. */
  key?: string;
  input?: unknown;
  /** The handler's name typed in: a handler with an effect runs only with it. */
  confirm?: string;
  /** Start it and answer at once: a read that takes minutes would outlast the page's request. */
  send?: boolean;
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
WHERE s.key IN ('loop', 'running', 'last')`;

/** The services with a loop object running: the Shop's "Off" for a part whose loops all stopped. */
export const runningLoops = (admin: RestateAdmin) => async (): Promise<ReadonlySet<string>> =>
  new Set(
    loopsOf(await admin(LOOPS_SQL))
      .filter((l) => l.running)
      .map((l) => l.service),
  );

/** One row per loop object (a `loop` key, or the `running` key before it), failing first, then by name. */
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
  for (const [id, { state: keys, next }] of objects) {
    // The one loop key (2026-10-05) carries what `running` and `last` did; it wins.
    const state = (keys.loop ?? keys) as Record<string, unknown>;
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

/**
 * Wren's spine arrivals (`spine_events`): a failed step says why, and Retry runs it again once
 * the cause is fixed. ponytail: main only; a client's events stay in its database until a
 * client's workflow fails for real.
 */
export const eventRecord = defineRecord({
  id: "console.event",
  name: { one: "event", many: "events" },
  view: "spine_events",
  key: "id",
  title: "subject",
  subtitle: "node",
  fields: {
    subject: text("About"),
    workflow: text("Workflow"),
    node: text("Node"),
    port: text("Port"),
    kind: text("Kind"),
    state: status({
      failed: { label: "Failed", tone: "bad" },
      waiting: { label: "Waiting", tone: "neutral" },
      passed: { label: "Passed on", tone: "good" },
    }),
    at: date("Arrived"),
    due: date("Due"),
    error: text("Why it failed"),
  },
  views: [
    { id: "failed", label: "Failed", where: { state: "failed" }, sort: "-at", at: "at" },
    { id: "waiting", label: "Waiting", where: { state: "waiting" }, sort: "due", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: ["console.retryEvent"],
});

/** One step of an execution: what arrived at a node's input, and what its step sent on. */
export interface ExecutionStep {
  id: string;
  node: string;
  port: string;
  kind: string;
  data: Record<string, unknown>;
  at: string;
  due: string | null;
  error: string | null;
  sent: SentEvent[] | null;
  sentAt: string | null;
}

/** An execution's id: its workflow and subject, as `spine_executions` keys it. */
export const executionId = (workflow: string, subject: string) => `${workflow}/${subject}`;

/** Every step one subject took through one workflow, in the order it took them. */
export async function executionSteps(db: Queryable, id: string): Promise<ExecutionStep[]> {
  const at = id.indexOf("/");
  if (at < 1) return [];
  const rows = (await db.execute(sql`
    select id::text id, node, port, kind, data, at, due, error, sent, sent_at "sentAt"
    from events where workflow = ${id.slice(0, at)} and subject = ${id.slice(at + 1)}
    order by at, id limit 500`)) as unknown as Array<
    Omit<ExecutionStep, "at" | "due" | "sentAt"> & {
      at: Date | string;
      due: Date | string | null;
      sentAt: Date | string | null;
    }
  >;
  const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
  return [...rows].map((r) => ({
    ...r,
    at: iso(r.at) as string,
    due: iso(r.due),
    sentAt: iso(r.sentAt),
  }));
}

/**
 * Wren's executions (`spine_executions`): each subject's walk through a workflow, where it is now
 * and how long since it entered. Its page lights the path and shows each step's data. ponytail:
 * main only, as `console.event`.
 */
export const executionRecord = defineRecord({
  id: "console.execution",
  name: { one: "execution", many: "executions" },
  view: "spine_executions",
  key: "id",
  title: "subject",
  subtitle: "workflow",
  fields: {
    subject: text("About"),
    workflow: text("Workflow"),
    kind: text("Kind"),
    state: status({
      failed: { label: "Failed", tone: "bad" },
      waiting: { label: "Waiting", tone: "neutral" },
      done: { label: "Done", tone: "good" },
    }),
    node: text("Now at"),
    entered: date("Entered"),
    lastAt: date("Last step"),
    due: date("Waiting until"),
    error: text("Why it failed"),
    steps: number("Steps"),
  },
  views: [
    { id: "all", label: "All", sort: "-lastAt", at: "entered" },
    { id: "waiting", label: "Waiting", where: { state: "waiting" }, sort: "due", at: "entered" },
    { id: "failed", label: "Failed", where: { state: "failed" }, sort: "-lastAt", at: "entered" },
    { id: "done", label: "Done", where: { state: "done" }, sort: "-lastAt", at: "entered" },
  ],
  // Retry is on its failed step, by that event's id.
  load: async (db, id) => ({ steps: await executionSteps(db, id) }),
});

/**
 * Units held out of a stage and sources paused on one (`./checks.ts`): why, and until when.
 * Release runs a unit again or resumes a source. ponytail: main only, as `console.event`.
 */
export const holdRecord = defineRecord({
  id: "console.hold",
  name: { one: "hold", many: "holds" },
  view: "unit_holds_now",
  key: "id",
  title: "subject",
  subtitle: "stage",
  fields: {
    subject: text("What"),
    stage: text("Stage"),
    state: status({
      held: { label: "Held 7 days", tone: "warn" },
      due: { label: "Retry due", tone: "neutral" },
      stuck: { label: "Needs a person", tone: "bad" },
      paused: { label: "Source paused", tone: "bad" },
      released: { label: "Released", tone: "good" },
    }),
    reason: text("Why"),
    tries: number("Tries"),
    heldAt: date("Held"),
    until: date("Until"),
    releasedBy: text("Released by"),
  },
  views: [
    {
      id: "open",
      label: "Open",
      where: { state: ["held", "due", "stuck", "paused"] },
      sort: "-heldAt",
      at: "heldAt",
    },
    { id: "all", label: "All", sort: "-heldAt", at: "heldAt" },
  ],
  actions: ["console.releaseHold"],
});

/** Each check's pass rate per stage and source over 30 days; under 70% of 50 pauses a source. */
export const checkRecord = defineRecord({
  id: "console.check",
  name: { one: "check", many: "checks" },
  view: "check_rates",
  key: "id",
  title: "check",
  subtitle: "source",
  fields: {
    check: text("Check"),
    stage: text("Stage"),
    source: text("Source"),
    rate: percent("Passed"),
    passed: number("Passes"),
    total: number("Outcomes"),
    state: status({ paused: { label: "Paused", tone: "bad" }, on: { label: "On", tone: "good" } }),
    lastAt: date("Last"),
  },
  views: [{ id: "all", label: "All", sort: "rate" }],
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

/** A form field's value in a settings block: `a.b` reads nested. */
const at = (block: Record<string, unknown>, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined),
      block,
    );
/** `block` with `path` set, or removed when `value` is undefined; the rest kept as it was. */
const setAt = (block: Record<string, unknown>, path: string, value: unknown) => {
  const [head = "", ...rest] = path.split(".");
  const out = { ...block };
  if (rest.length) {
    const inner = out[head] && typeof out[head] === "object" ? out[head] : {};
    out[head] = setAt(inner as Record<string, unknown>, rest.join("."), value);
  } else if (value === undefined) delete out[head];
  else out[head] = value;
  return out;
};
/** A setting as one line he reads and types. */
const settingText = (f: HandlerField, v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (f.type === "switch") return v ? "on" : "off";
  if (Array.isArray(v) && (f.type === "lines" || f.type === "numbers")) return v.join(", ");
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};
/** What he typed, as the schema takes it; blank goes back to the default. */
const settingValue = (f: HandlerField, typed: string): unknown => {
  const t = typed.trim();
  if (!t) return undefined;
  if (f.type === "number") return Number(t);
  if (f.type === "switch")
    return /^(on|yes|true)$/i.test(t) ? true : /^(off|no|false)$/i.test(t) ? false : t;
  if (f.type === "lines")
    return t
      .split(t.includes("\n") ? /\n/ : /,/)
      .map((x) => x.trim())
      .filter(Boolean);
  if (f.type === "numbers")
    return t
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
  if (f.type === "json") {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return typed;
};

/**
 * Wren's own settings, one row per setting of each part that runs for Wren (`wren_settings`):
 * edited in place with History, Undo and Ask Claude (`./edits.ts`). Saving one keeps the rest of
 * its block, prices included, and needs `manage`, as the Shop's Save does.
 */
export function settingRecord(all: readonly Component[]): RecordType {
  const settings = all
    .filter((c) => c.wrenSettings)
    .flatMap((c) => (settingsForm(c) ?? []).map((f) => ({ c, f, id: `${c.id}:${f.field}` })));
  const one = (id: string) => settings.find((s) => s.id === id);
  const blockFor = async (db: Queryable, c: Component) => {
    const block = (await settingsFor(db, null))[c.id];
    return block && typeof block === "object" ? (block as Record<string, unknown>) : {};
  };
  /** The block a patch makes, or why the part's schema won't take it. */
  const next = async (db: Queryable, id: string, patch: Values) => {
    const s = one(id);
    if (!s) throw new PortalRefusal("no such setting", 404);
    const block = setAt(
      await blockFor(db, s.c),
      s.f.field,
      settingValue(s.f, String(patch.value ?? "")),
    );
    const out = s.c.settings.safeParse(block);
    const problem = out.success
      ? null
      : out.error.issues.map((i) => i.message).join("; ") || "the part won't take that";
    return { s, block, problem };
  };
  return defineRecord({
    id: "console.setting",
    name: { one: "setting", many: "settings" },
    rows: async (db) => {
      const saved = await db.select().from(wrenSettings);
      const blocks = Object.fromEntries(saved.map((r) => [r.component, r]));
      return settings.map(({ c, f, id }) => {
        const row = blocks[c.id];
        return {
          id,
          part: c.name,
          setting: f.label,
          value: settingText(f, at(shownSettings(c, row?.settings) ?? {}, f.field)),
          hint: f.hint ?? null,
          choices: f.options?.join(", ") ?? null,
          updated_at: row?.updatedAt?.toISOString() ?? null,
          updated_by: row?.updatedBy ?? null,
        };
      });
    },
    key: "id",
    title: "setting",
    subtitle: "part",
    fields: {
      part: text("Part"),
      setting: text("Setting"),
      value: text("Value"),
      hint: text("What it does"),
      choices: text("Choices"),
      updatedAt: date("Saved"),
      updatedBy: text("By"),
    },
    views: [{ id: "all", label: "All" }],
    edits: {
      fields: ["value"],
      patch: wordsPatch({ value: 4000 }),
      needs: "manage",
      about: "one of Wren's own settings, typed as text; blank puts the default back",
      read: async (db, id) => {
        const s = one(id);
        if (!s) return null;
        return {
          value: settingText(s.f, at(shownSettings(s.c, await blockFor(db, s.c)) ?? {}, s.f.field)),
        };
      },
      check: async (patch, _now, db, id) => (await next(db, id, patch)).problem,
      write: async (db, id, patch, by) => {
        const { s, block, problem } = await next(db, id, patch);
        if (problem) throw new PortalRefusal(problem, 400);
        await setWrenSettings(db, s.c.id, block, by);
      },
      context: async (_db, id) => {
        const s = one(id);
        if (!s) return null;
        return [
          `${s.c.name}: ${s.c.blurb}`,
          `Setting "${s.f.label}"${s.f.hint ? `: ${s.f.hint}` : ""}.`,
          s.f.options ? `One of: ${s.f.options.join(", ")}.` : "",
          s.f.type ? `Typed as ${s.f.type}.` : "",
        ]
          .filter(Boolean)
          .join("\n");
      },
    },
  });
}

const COMPONENT = "console.component";

const neutral = (labels: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(labels).map(([k, label]) => [k, { label, tone: "neutral" as const }]),
  );
const readyOf = (c: Component) => (c.planned ? "planned" : c.ready ? "ready" : "coming");
/** A workflow is as far along as its least built part. */
const flowReady = (parts: readonly Component[]) =>
  (["planned", "coming"] as const).find((s) => parts.some((c) => readyOf(c) === s)) ?? "ready";
const union = <T>(lists: readonly (readonly T[])[]) => [...new Set(lists.flat())];

/**
 * The shop: every part in `all` and every workflow over them, each marked installed or not for
 * `client` when there is one (a workflow installs part by part until templates). The detail
 * carries ports, the hypothesis, what's inside and where it's used; the team's adds what a part
 * provides and its settings form, filled from the client's block.
 */
export const componentRecord = (
  all: readonly Component[],
  client: Client | null,
  team: boolean,
  workflows: readonly Workflow[] = [],
  /** The client's saves, and why one was left out: the team's, for the canvas's editing. */
  saves: { saved: Record<string, SavedWorkflow>; broken: Record<string, string[]> } = {
    saved: {},
    broken: {},
  },
  /**
   * The loop services running now, read when the list is: a part that runs for Wren with every
   * loop stopped reads "Off" to the team. Null or a failed read: no one is marked off.
   */
  running?: () => Promise<ReadonlySet<string>>,
): RecordType => {
  const flows = workflows.filter((w) => team || w.for === "client");
  /** A workflow that is a part's inside shows as that part, never twice. */
  const shownAs = (w: Workflow) => all.find((c) => c.inside === w.id) ?? w;
  const named = (id: string) =>
    all.find((x) => x.id === id)?.name ?? flows.find((w) => w.id === id)?.name ?? id;
  const usedIn = (id: string) =>
    flows
      .filter((w) => w.nodes.some((n) => n.uses === id))
      .map((w) => ({ id: shownAs(w).id, name: shownAs(w).name }));
  /**
   * Where the number on `uses`'s out port comes from: the part's own, or, for a workflow, the
   * port of the inner node whose wire feeds it. The team's only: a client's records aren't here.
   */
  const countOf = (uses: string | undefined, port: string, seen = new Set<string>()) => {
    if (!team || !uses || seen.has(uses)) return null;
    seen.add(uses);
    const c = all.find((x) => x.id === uses);
    if (c) return c.out.find((p) => p.id === port)?.count ?? null;
    const f = workflows.find((x) => x.id === uses);
    const [node = "", inner = ""] =
      f?.wires.find((x) => x.to === `out.${port}`)?.from.split(".") ?? [];
    return countOf(f?.nodes.find((n) => n.id === node)?.uses, inner, seen);
  };
  const portsOf = (uses: string | undefined): readonly Port[] =>
    all.find((x) => x.id === uses)?.out ?? workflows.find((x) => x.id === uses)?.out ?? [];
  /**
   * A workflow's nodes, each with what it uses and its main number's source (its first counted
   * port), and its wires with what moves on each and that number's source, for the drawings.
   */
  const drawn = (w: Workflow) => ({
    id: w.id,
    name: w.name,
    in: w.in,
    out: w.out,
    nodes: w.nodes.map((n) => {
      const c = all.find((x) => x.id === n.uses);
      const f = workflows.find((x) => x.id === n.uses);
      const main = portsOf(n.uses)
        .map((p) => ({ label: p.label, count: countOf(n.uses, p.id) }))
        .find((p) => p.count);
      const ports = n.own ?? c ?? f;
      return {
        id: n.id,
        uses: n.uses ?? null,
        /** Its ports, for wiring on the canvas. */
        in: ports?.in ?? [],
        out: ports?.out ?? [],
        name: n.own?.name ?? named(n.uses ?? n.id),
        note: n.note ?? (n.own ? "Custom step" : null),
        ready: c ? readyOf(c) : f ? flowReady(partsIn(f.id, flows, all)) : null,
        /** The workflow it opens into: one it uses, or the part's own steps. */
        opens: f ? f.id : (c?.inside ?? null),
        count: main ? { ...main.count, label: main.label } : null,
      };
    }),
    wires: w.wires.map((x) => {
      const [node = "", port = ""] = x.from.split(".");
      const uses = w.nodes.find((n) => n.id === node)?.uses;
      const label =
        (node === "in" ? w.in : portsOf(uses)).find((p) => p.id === port)?.label ?? port;
      return { ...x, label, count: node === "in" ? null : countOf(uses, port) };
    }),
  });
  return defineRecord({
    id: COMPONENT,
    name: { one: "component", many: "components" },
    rows: async () => {
      const on = team && running ? await running().catch(() => null) : null;
      const off = (c: Component) =>
        !!on &&
        readyOf(c) === "coming" &&
        c.provides.loops.length > 0 &&
        !c.provides.loops.some((l) => on.has(l));
      return [
        ...all.map((c) => ({
          id: c.id,
          type: "part",
          name: c.name,
          blurb: c.blurb,
          icon: c.icon,
          stage: c.stage,
          channels: c.channels.join(",") || null,
          for: c.for,
          ready: off(c) ? "off" : readyOf(c),
          // Wren's own parts are never on a client: no "not installed" for them.
          installed: client && c.for === "client" ? (has(client, c.id) ? "yes" : "no") : null,
          effects: c.effects.join(",") || null,
          // The SaaS it stands in for, quietly: its closest vendor's name only.
          instead: inHouseOfPart(c.id)?.instead[0]?.vendor ?? null,
          needs: [...c.requires.components, ...c.requires.accounts].join(", ") || null,
          missing:
            [
              ...(off(c)
                ? [
                    `Off: ${c.provides.loops.join(" and ")} ${c.provides.loops.length > 1 ? "are" : "is"} stopped. Start it in Loops`,
                  ]
                : []),
              ...c.missing,
            ].join("; ") || null,
        })),
        ...flows
          .filter((w) => shownAs(w) === w)
          .map((w) => {
            const parts = partsIn(w.id, flows, all);
            const behind = parts.filter((c) => !c.ready);
            return {
              id: w.id,
              type: "workflow",
              name: w.name,
              blurb: w.blurb,
              icon: w.icon,
              stage: w.stage,
              channels: union(parts.map((c) => c.channels)).join(",") || null,
              for: w.for,
              ready: flowReady(parts),
              installed: null,
              effects: union(parts.map((c) => c.effects)).join(",") || null,
              instead: null,
              needs: null,
              missing: behind.length
                ? `${behind.map((c) => c.name).join(", ")} ${behind.length > 1 ? "aren't" : "isn't"} ready`
                : null,
            };
          }),
      ];
    },
    key: "id",
    title: "name",
    subtitle: "blurb",
    fields: {
      name: text("Name"),
      blurb: text("What it does"),
      instead: text("In place of"),
      type: status(neutral({ part: "Part", workflow: "Workflow" }), "Type"),
      stage: status(neutral(STAGES), "Stage"),
      channels: tags(neutral(CHANNELS), "Channels"),
      ready: status(
        {
          ready: { label: "Ready", tone: "good" },
          // Built and running for Wren, not yet per client: the team sees it run, a client waits.
          coming: team
            ? { label: "Runs for Wren", tone: "good" }
            : { label: "Coming", tone: "neutral" },
          planned: { label: "In development", tone: "neutral" },
          // Built, but its loop is stopped: nothing runs until the team starts it.
          ...(team ? { off: { label: "Off", tone: "neutral" as const } } : {}),
        },
        "Status",
      ),
      installed: status(
        {
          yes: { label: "Installed", tone: "good" },
          no: { label: "Not installed", tone: "neutral" },
        },
        "Installed",
      ),
      effects: tags(
        neutral({ sends: "Sends messages", spends: "Spends money", posts: "Posts publicly" }),
        "Effects",
      ),
      for: status(neutral({ client: "For clients", wren: "Wren's own" }), "For"),
      icon: text("Icon", { group: "System" }),
      needs: text("Needs"),
      missing: text("Missing"),
    },
    views: [
      { id: "all", label: "All", sort: "name" },
      ...(client
        ? [{ id: "installed", label: "Installed", where: { installed: "yes" }, sort: "name" }]
        : []),
    ],
    load: async (db, id) => {
      const w = flows.find((x) => x.id === id);
      if (w)
        return {
          workflow: drawn(w),
          usedIn: usedIn(id),
          ...(team ? { saved: saves.saved[id] ?? null, broken: saves.broken[id] ?? [] } : {}),
        };
      const c = all.find((x) => x.id === id);
      if (!c) return null;
      const installed = !!client && has(client, c.id);
      const inside = c.inside ? workflows.find((x) => x.id === c.inside) : undefined;
      return {
        needs: [
          ...c.requires.components.map((id) => ({
            label: named(id),
            has: client ? has(client, id) : null,
          })),
          ...c.requires.accounts.map((site) => ({
            label: `A ${site} account`,
            has: client ? !!client.accounts[site] : null,
          })),
        ],
        effects: c.effects,
        installed,
        in: c.in,
        out: c.out,
        hypothesis: c.hypothesis,
        inside: inside ? drawn(inside) : null,
        usedIn: usedIn(id),
        ...(team
          ? {
              provides: c.provides,
              // Saving goes to Wren's block (`configure` with no client): the part isn't the client's.
              wrenSettings: c.wrenSettings && !installed,
              form: settingsForm(c),
              // The block a save writes: the client's when installed, else Wren's (`wren_settings`).
              values: shownSettings(
                c,
                (await settingsFor(db, installed || !c.wrenSettings ? (client?.id ?? null) : null))[
                  c.id
                ],
              ),
            }
          : {}),
      };
    },
  });
};

/** The runs row's command: one line on the run trail, as a CLI command would be. */
export const callCommand = (service: string, handler: string) =>
  `console ${service}/${handler}`.slice(0, 64);

export function consoleApi({
  main,
  views,
  moneyViews = [],
  admin,
  adminGet,
  records = [],
  mainUrl,
  components = [],
  workflows = [],
  asked,
  bound = () => true,
  edge,
}: {
  main: Db;
  /** The main database's URL, which `addClient` needs to reach the new one; absent, it refuses. */
  mainUrl?: string | undefined;
  views: readonly string[];
  /** Views of costs and spend: for whoever holds `money` at Wren. */
  moneyViews?: readonly string[];
  /** Absent, `loops` refuses: this worker can't see Restate's state. */
  admin?: RestateAdmin | undefined;
  /** Absent, `call` refuses and there is no handler list. */
  adminGet?: RestateAdminGet | undefined;
  /** The team's record types; the loops join them when there's an admin. */
  records?: readonly RecordType[];
  /** Every component, for the catalog and installs (`COMPONENTS` in the worker). */
  components?: readonly Component[];
  /** Every workflow over them, shown in the catalog beside its parts (`WORKFLOWS`). */
  workflows?: readonly Workflow[];
  /** A client's person asked for `c`: tell Wren. Absent, `ask` refuses. */
  asked?: ((client: Client, by: string, c: Component) => Promise<void>) | undefined;
  /** Whether this worker binds `service`: a component's loop on one it doesn't is skipped. */
  bound?: ((service: string) => boolean) | undefined;
  /** Sends the lander its flags on every change; absent, site flags wait for the next pass. */
  edge?: EdgePush | undefined;
}) {
  const allowed = new Set([...views, ...moneyViews]);
  const money = new Set(moneyViews);
  const types = [
    ...records,
    ...(admin ? [loopRecord(admin)] : []),
    ...(adminGet ? [handlerRecord(adminGet)] : []),
    teamRecord,
    changeRecord,
    settingRecord(components),
    snippetRecord(),
    flagRecord(edge),
    experimentRecord(),
    workflowRecord(workflows, components),
    eventRecord,
    executionRecord,
    holdRecord,
    checkRecord,
  ];
  const team = (req: PortalRequest) => {
    if (!seesInternal(req)) throw new PortalRefusal("that's for Wren's team", 403);
  };
  /** A change by the team at Wren: `run` there, never the demo. Who made it. */
  const teamWriter = (req: PortalRequest): string => {
    team(req);
    if (!teamCan(req, "run", WREN)) throw new PortalRefusal("your role can't change that", 403);
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    return (req.viewer as SignedViewer).email;
  };
  /**
   * The team's types and the catalog, or the catalog alone for anyone else: what a client can
   * have, marked installed for the client picked.
   */
  const typesFor = async (req: PortalRequest): Promise<RecordType[]> => {
    const internal = seesInternal(req);
    const client =
      (req.client && req.client !== WREN) || !internal ? await pickClient(main, req) : null;
    const shown = internal ? components : components.filter((c) => c.for === "client");
    // Wren's own records, each for whoever holds what it needs at Wren (Money: `money`).
    const allowed = internal ? types.filter((t) => teamCan(req, t.needs ?? "read", WREN)) : [];
    // Snippets' tags are free text: each one in use is a facet, read when they're asked for.
    const asked = (req as { record?: unknown }).record;
    const tagged =
      internal && (asked === SNIPPET || asked === undefined)
        ? // Facets are a nicety: a failed read lists the type with plain-word tags.
          snippetRecord(await snippetTags(main).catch(() => []))
        : null;
    const mine = tagged ? allowed.map((t) => (t.id === SNIPPET ? tagged : t)) : allowed;
    // The client's own wiring, as the spine runs it: only one catalog item draws a workflow.
    const one = (req as { record?: unknown; id?: unknown }).record === COMPONENT && "id" in req;
    const saved = one ? await savedWorkflows(main, client?.id ?? null) : {};
    const { flows, broken } = flowsWith(workflows, editsOf(saved), components);
    return [
      ...mine,
      componentRecord(
        shown,
        client,
        internal,
        flows,
        { saved, broken },
        internal && admin ? runningLoops(admin) : undefined,
      ),
    ];
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
  /**
   * Whose saved views and prefs: the viewer's, in Wren's own apps or at the client asked for. The
   * demo keeps nothing; sharing needs `manage` in that workspace.
   */
  const keeper = async (req: KeepRequest, writes = false) => {
    if (isDemo(req.viewer)) {
      if (writes) throw new PortalRefusal("the demo is read-only", 403);
      return { scope: { workspace: "demo", viewer: "demo" }, share: false };
    }
    const atWren = seesInternal(req) && (!req.client || req.client === WREN);
    const workspace = atWren ? WREN : (await pickClient(main, req)).id;
    const viewer = normalEmail((req.viewer as SignedViewer).email);
    const share = can(
      await whoIs(main, req.viewer, atWren ? undefined : workspace),
      "manage",
      workspace,
    );
    return { scope: { workspace, viewer }, share };
  };
  const recordOf = (req: KeepRequest) => {
    if (typeof req.record !== "string" || !req.record || req.record.length > 64)
      throw new PortalRefusal("say which list", 400);
    return req.record;
  };
  /** One of Wren's records that declares edits, for a teammate who may run things at Wren. */
  const editable = async (req: PortalRequest & { record?: unknown; id?: unknown }) => {
    team(req);
    const t = (await typesFor(req)).find((x) => x.id === req.record);
    if (!t) throw new PortalRefusal("no such record", 404);
    if (!t.edits) throw new PortalRefusal(`${t.name.many} can't be edited`, 400);
    const needs = t.edits.needs ?? "run";
    if (!teamCan(req, needs, WREN)) throw new PortalRefusal(`changing these needs ${needs}`, 403);
    const id = typeof req.id === "string" || typeof req.id === "number" ? String(req.id) : "";
    if (!id || id.length > 200) throw new PortalRefusal("say which one", 400);
    return { t, id, by: (req.viewer as SignedViewer).email };
  };
  /** An edit or undo in one transaction, audited as the teammate's. */
  const write = async <T>(
    req: PortalRequest & { record?: unknown; id?: unknown },
    change: (tx: Queryable, t: RecordType, id: string, by: string) => Promise<T>,
  ): Promise<T> => {
    const { t, id, by } = await editable(req);
    return serializable(main, async (tx) => {
      await setAuditActor(tx, by);
      return change(tx, t, id, by);
    });
  };
  /** Accept names the ask its patch came from: it must be this record's, and answered. */
  const askOn = async (db: Queryable, run: string, record: string, id: string) => {
    const [r] = await db
      .select({ argv: runs.argv, done: runs.finishedAt })
      .from(runs)
      .where(and(eq(runs.id, run), eq(runs.command, ASK_COMMAND)));
    const a = r?.argv as { record?: string; id?: string } | undefined;
    if (!r?.done || a?.record !== record || a?.id !== id)
      throw new PortalRefusal("that answer isn't this record's", 400);
  };

  /** A team change in one transaction, logged as the admin's. */
  const teamWrite = async <T>(
    req: TeamSeatRequest,
    change: (tx: Queryable, email: string) => Promise<T>,
  ): Promise<T> => {
    team(req);
    const email = typeof req.email === "string" ? normalEmail(req.email) : "";
    if (!EMAIL.test(email) || email.length > 254)
      throw new PortalRefusal("that isn't an email", 400);
    try {
      return await serializable(main, async (tx) => {
        await setAuditActor(tx, (req.viewer as SignedViewer).email);
        return change(tx, email);
      });
    } catch (err) {
      if (err instanceof LastAdmin) throw new PortalRefusal(err.message, 409);
      throw err;
    }
  };
  /** An experiment button's writer (`manage` at Wren) and the flags it names. */
  const experimentIds = (req: PortalRequest & { ids?: unknown }): [string, string[]] => {
    const by = teamWriter(req);
    if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
    const ids = Array.isArray(req.ids) ? req.ids.filter((x) => typeof x === "string") : [];
    if (!ids.length) throw new PortalRefusal("say which experiment", 400);
    return [by, ids];
  };
  /**
   * A seat's client list, each a client or `wren`; undefined leaves it as it is. A form's text
   * ("acme, wren") splits on commas; blank or "all" is every client.
   */
  const clientsOf = async (tx: Queryable, given: unknown): Promise<string[] | null | undefined> => {
    const list =
      typeof given === "string"
        ? given.trim() === "" || given.trim().toLowerCase() === "all"
          ? null
          : given
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean)
        : given;
    if (list === undefined || list === null) return list;
    if (!Array.isArray(list) || !list.every((c) => typeof c === "string"))
      throw new PortalRefusal("clients: a list of client ids, or null for all", 400);
    const known = new Set(
      (await tx.select({ id: clients.id }).from(clients)).map((c) => c.id).concat(WREN),
    );
    const unknown = list.filter((c) => !known.has(c));
    if (unknown.length) throw new PortalRefusal(`no such client: ${unknown.join(", ")}`, 400);
    return list;
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
  /** New settings over the old: a field left out keeps its value. */
  const merged = (c: Component, old: unknown, settings: unknown) =>
    blockOf(c, { ...(old && typeof old === "object" ? old : {}), ...blockOf(c, settings) });
  /** `configure` for Wren's own run: the team's `wren:manage`, kept in `wren_settings`, a runs row. */
  const configureWren = async (req: InstallRequest, c: Component) => {
    team(req);
    if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
    const by = (req.viewer as SignedViewer).email;
    const block = merged(c, (await settingsFor(main, null))[c.id], req.settings);
    const run = await openRun(main, {
      command: `console configure ${c.id}`.slice(0, 64),
      argv: { by, client: WREN, settings: block },
    });
    try {
      await serializable(main, async (tx) => {
        await setAuditActor(tx, by);
        await setWrenSettings(tx, c.id, block, by);
      });
    } catch (err) {
      await finishRun(main, run.id, { error: String(err).slice(0, 500) });
      throw err;
    }
    await finishRun(main, run.id, { ok: true });
    return { client: WREN, component: c.id, installed: false, start: [], stop: [] };
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
      if (money.has(req.view) && !teamCan(req, "money", WREN))
        throw new PortalRefusal("your role can't see that", 403);
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

    /** A patch to one of Wren's records, compare-and-swapped on `expect` (`./edits.ts`). */
    recordsEdit: (req: EditRequest): Promise<Edited> =>
      write(req, async (tx, t, id, by) => {
        const run = typeof req.run === "string" ? req.run : null;
        if (run) await askOn(tx, run, t.id, id);
        return editRecord(tx, t, id, {
          patch: req.patch,
          expect: typeof req.expect === "string" ? req.expect : null,
          by,
          via: run ? "claude" : "person",
          run,
        });
      }),
    /** Put one change's before back. */
    recordsUndo: (req: UndoRequest): Promise<Edited> =>
      write(req, (tx, t, id, by) => {
        if (!Number.isSafeInteger(req.change)) throw new PortalRefusal("say which change", 400);
        return undoChange(tx, t, id, req.change as number, by);
      }),
    /** Ask Claude on a record: the run row holding the prompt, for `Ask/edit` to answer. */
    recordsAskOpen: async (req: AskRequest): Promise<string> => {
      const { t, id, by } = await editable(req);
      const message = typeof req.message === "string" ? req.message.trim() : "";
      if (!message) throw new PortalRefusal("say what to change, or ask", 400);
      if (message.length > ASK_MESSAGE_MAX)
        throw new PortalRefusal(`keep it under ${ASK_MESSAGE_MAX} characters`, 400);
      const { row } = await read(req as PortalRequest & { record: string }, (r) =>
        r.get({ record: t.id, id }),
      );
      const prompt = await askPrompt(main, t, id, row, message, by);
      const argv = {
        record: t.id,
        id,
        by,
        message,
        question: prompt.question,
        system: prompt.system,
      };
      return (await openRun(main, { command: ASK_COMMAND, argv, model: "claude-code:sonnet" })).id;
    },

    /** A viewer's saved views of one list: his own and the shared ones. */
    savedViews: async (req: KeepRequest) =>
      savedViewsOf(main, (await keeper(req)).scope, recordOf(req)),
    /** Make or change one; sharing needs `manage` where it's shared. */
    saveView: async (req: KeepRequest) => {
      const { scope, share } = await keeper(req, true);
      return saveView(
        main,
        scope,
        {
          id: Number.isSafeInteger(req.id) ? (req.id as number) : undefined,
          record: recordOf(req),
          name: typeof req.name === "string" ? req.name : undefined,
          params: typeof req.params === "string" ? req.params : undefined,
          shared: typeof req.shared === "boolean" ? req.shared : undefined,
        },
        share,
      );
    },
    removeView: async (req: KeepRequest) => {
      const { scope, share } = await keeper(req, true);
      if (!Number.isSafeInteger(req.id)) throw new PortalRefusal("say which view", 400);
      await removeView(main, scope, req.id as number, share);
      return { removed: req.id };
    },
    moveViews: async (req: KeepRequest) => {
      const { scope } = await keeper(req, true);
      const ids = Array.isArray(req.ids) ? req.ids.filter(Number.isSafeInteger) : [];
      return moveViews(main, scope, recordOf(req), ids as number[]);
    },
    /** What the viewer arranged, by key (`./saved-views.ts`). */
    prefs: async (req: KeepRequest) => {
      const { scope } = await keeper(req);
      const keys = Array.isArray(req.keys) ? req.keys.filter((k) => typeof k === "string") : [];
      return prefsOf(main, scope, keys.length ? (keys as string[]) : undefined);
    },
    setPref: async (req: KeepRequest) => {
      const { scope } = await keeper(req, true);
      if (typeof req.key !== "string") throw new PortalRefusal("say which setting", 400);
      await setPref(main, scope, req.key, req.value ?? null);
      return { key: req.key };
    },

    /** Wren's snippets for the Insert picker: the team's, in any workspace it drafts in. */
    snippets: async (req: PortalRequest) => {
      team(req);
      return snippetsOf(main);
    },
    snippetAdd: async (req: PortalRequest & SnippetInput) => {
      const by = teamWriter(req);
      const { title, body, tags, channel } = req;
      return addSnippet(main, { title, body, tags, channel }, by);
    },
    /** Flags are a release decision: `manage` at Wren. */
    flagAdd: async (req: PortalRequest & FlagInput) => {
      const by = teamWriter(req);
      if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
      const { key, about, surface, variants } = req;
      return addFlag(main, { key, about, surface, variants }, by, edge);
    },
    flagRemove: async (req: PortalRequest & { ids?: unknown }) => {
      teamWriter(req);
      if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
      const ids = Array.isArray(req.ids) ? req.ids.filter((x) => typeof x === "string") : [];
      if (!ids.length) throw new PortalRefusal("say which flag", 400);
      return { done: await removeFlags(main, ids, edge) };
    },
    /** Experiments: Start and Ship put a variant live on the public site, so `manage` (William). */
    experimentAdd: async (req: PortalRequest & ExperimentInput) => {
      const by = teamWriter(req);
      if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
      return addExperiment(main, { flag: req.flag, goal: req.goal }, by);
    },
    experimentStart: async (req: PortalRequest & { ids?: unknown }) => {
      const [by, ids] = experimentIds(req);
      return { done: await startExperiments(main, ids, by, edge) };
    },
    experimentShip: async (req: PortalRequest & { ids?: unknown }) => {
      const [by, ids] = experimentIds(req);
      return { done: await shipExperiments(main, ids, by, edge) };
    },
    experimentStop: async (req: PortalRequest & { ids?: unknown }) => {
      const [by, ids] = experimentIds(req);
      return { done: await stopExperiments(main, ids, by, edge) };
    },
    experimentRemove: async (req: PortalRequest & { ids?: unknown }) => {
      const [, ids] = experimentIds(req);
      return { done: await removeExperiments(main, ids) };
    },
    /** A record action: `{ids}`, each removed. */
    snippetRemove: async (req: PortalRequest & { ids?: unknown }) => {
      teamWriter(req);
      const ids = Array.isArray(req.ids) ? req.ids.map(Number).filter(Number.isSafeInteger) : [];
      if (!ids.length) throw new PortalRefusal("say which snippet", 400);
      for (const id of ids) await removeSnippet(main, id);
      return { done: ids };
    },

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

    /**
     * Wren's team, by an admin (the guard checks `team`): invite or change a seat, or remove one.
     * The last admin stays; a narrower seat or a removal signs the person out.
     */
    teamSet: (req: TeamSeatRequest) =>
      teamWrite(req, async (tx, email) => {
        const role = req.role;
        if (role !== undefined && !TEAM_ROLES.includes(role))
          throw new PortalRefusal(`role: one of ${TEAM_ROLES.join(", ")}`, 400);
        const list = await clientsOf(tx, req.clients);
        return setTeamSeat(tx, email, {
          ...(role ? { role } : {}),
          ...(list === undefined ? {} : { clients: list }),
        });
      }),
    teamRemove: (req: TeamSeatRequest) =>
      teamWrite(req, async (tx, email) => {
        if (!(await removeTeamSeat(tx, email)))
          throw new PortalRefusal("they aren't on the team", 404);
        return { removed: email };
      }),

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
      // Wren's own run has no client: its block is `wren_settings`.
      componentOf(req).wrenSettings && (!req.client || req.client === WREN)
        ? configureWren(req, componentOf(req))
        : change(req, "configure", (c, client) => {
            if (!has(client, c.id)) throw new PortalRefusal("not installed", 404);
            return merged(c, client.products[c.id], req.settings);
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
    /**
     * A workflow's wiring from the canvas, for Wren or a client: checked as the spine would run it,
     * then kept as a new version. A client gets only workflows for clients.
     */
    async workflowSave(req: WorkflowSaveRequest): Promise<{ id: number }> {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      // No client is Wren's own, as the catalog reads it.
      const client = req.client ? (await pickForWrite(main, req)).client : null;
      const w = workflows.find((x) => x.id === req.workflow);
      if (!w) throw new PortalRefusal("no such workflow", 404);
      if (client && w.for === "wren") throw new PortalRefusal("that runs Wren's own business", 409);
      let edits: WorkflowEdits | null = null;
      if (!req.reset) {
        const got = EDITS.safeParse({ wires: req.wires, steps: req.steps });
        if (!got.success) {
          const i = got.error.issues[0];
          throw new PortalRefusal(`that doesn't read: ${i?.path.join(".")} ${i?.message}`, 400);
        }
        edits = got.data as WorkflowEdits;
        const bad = flowsWith(workflows, { [w.id]: edits }, components).broken[w.id];
        if (bad) throw new PortalRefusal(bad.join("; "), 400);
      }
      const [row] = await main
        .insert(workflowSaves)
        .values({
          client: client?.id ?? null,
          workflow: w.id,
          edits,
          by: (req.viewer as SignedViewer).email,
        })
        .returning({ id: workflowSaves.id });
      return { id: row?.id ?? 0 };
    },

    /** The failed event Retry names, checked before any step runs. */
    eventToRetry(req: PortalRequest & { id?: unknown }): string {
      team(req);
      if (!teamCan(req, "effect", WREN)) throw new PortalRefusal("your role can't run that", 403);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const id = typeof req.id === "string" ? req.id : "";
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new PortalRefusal("no such event", 404);
      return id;
    },

    /** Let a hold go: the unit runs again, or the source resumes. */
    async releaseHold(req: PortalRequest & { id?: unknown }): Promise<{ done: number[] }> {
      team(req);
      if (!teamCan(req, "run", WREN)) throw new PortalRefusal("your role can't run that", 403);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const id = Number(req.id);
      if (!Number.isInteger(id) || id <= 0) throw new PortalRefusal("no such hold", 404);
      const rows = await serializable(main, async (tx) => {
        await setAuditActor(tx, (req.viewer as SignedViewer).email);
        return release(tx, [id], (req.viewer as SignedViewer).email);
      });
      if (rows.length === 0) throw new PortalRefusal("it isn't held now", 409);
      return { done: rows.map((r) => r.id) };
    },

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
      if (h.effect && !teamCan(req, "effect", WREN))
        throw new PortalRefusal(`it ${h.effect}: your role can't do that`, 403);
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
  return portalService({
    name: "ConsolePortal",
    main: deps.main,
    routes: CONSOLE_ROUTES,
    unnamed: "wren",
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
      // One write each, journaled: a retry returns the same answer, never a second change.
      recordsEdit: (ctx: restate.Context, req: EditRequest) =>
        answer(() => ctx.run("edit", () => answer(() => api.recordsEdit(req)))),
      recordsUndo: (ctx: restate.Context, req: UndoRequest) =>
        answer(() => ctx.run("undo", () => answer(() => api.recordsUndo(req)))),
      recordsAsk: (ctx: restate.Context, req: AskRequest) =>
        answer(async () => {
          const id = await ctx.run("open run", () => answer(() => api.recordsAskOpen(req)));
          ctx.serviceSendClient<AskService>(ASK).edit({ id });
          return { id };
        }),
      savedViews: (_: restate.Context, req: KeepRequest) => answer(() => api.savedViews(req)),
      saveView: (ctx: restate.Context, req: KeepRequest) =>
        answer(() => ctx.run("save view", () => answer(() => api.saveView(req)))),
      removeView: (ctx: restate.Context, req: KeepRequest) =>
        answer(() => ctx.run("remove view", () => answer(() => api.removeView(req)))),
      moveViews: (ctx: restate.Context, req: KeepRequest) =>
        answer(() => ctx.run("move views", () => answer(() => api.moveViews(req)))),
      prefs: (_: restate.Context, req: KeepRequest) => answer(() => api.prefs(req)),
      snippets: (_: restate.Context, req: PortalRequest) => answer(() => api.snippets(req)),
      snippetAdd: (ctx: restate.Context, req: PortalRequest & SnippetInput) =>
        answer(() => ctx.run("add snippet", () => answer(() => api.snippetAdd(req)))),
      snippetRemove: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("remove snippet", () => answer(() => api.snippetRemove(req)))),
      flagAdd: (ctx: restate.Context, req: PortalRequest & FlagInput) =>
        answer(() => ctx.run("add flag", () => answer(() => api.flagAdd(req)))),
      flagRemove: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("remove flag", () => answer(() => api.flagRemove(req)))),
      experimentAdd: (ctx: restate.Context, req: PortalRequest & ExperimentInput) =>
        answer(() => ctx.run("add experiment", () => answer(() => api.experimentAdd(req)))),
      experimentStart: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("start experiment", () => answer(() => api.experimentStart(req)))),
      experimentShip: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("ship experiment", () => answer(() => api.experimentShip(req)))),
      experimentStop: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("stop experiment", () => answer(() => api.experimentStop(req)))),
      experimentRemove: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("remove experiment", () => answer(() => api.experimentRemove(req)))),
      setPref: (ctx: restate.Context, req: KeepRequest) =>
        answer(() => ctx.run("set pref", () => answer(() => api.setPref(req)))),
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
          const target = {
            service: h.service,
            method: h.handler,
            ...(h.kind === "service" ? {} : { key: req.key as string }),
            // The operator is the viewer, whatever the input says.
            parameter: h.viewer ? { ...(req.input as object), viewer: req.viewer } : req.input,
            inputSerde: JSON_SERDE,
          };
          if (req.send) {
            ctx.genericSend(target);
            await ctx.run("close run", () => api.closeCall(runId, null));
            return { sent: true };
          }
          try {
            const out = await ctx.genericCall<unknown, unknown>({
              ...target,
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
      teamSet: (_: restate.Context, req: TeamSeatRequest) => answer(() => api.teamSet(req)),
      teamRemove: (_: restate.Context, req: TeamSeatRequest) => answer(() => api.teamRemove(req)),
      install: (ctx: restate.Context, req: InstallRequest) =>
        changeLoops(ctx, "install", () => api.install(req)),
      configure: (ctx: restate.Context, req: InstallRequest) =>
        changeLoops(ctx, "configure", () => api.configure(req)),
      uninstall: (ctx: restate.Context, req: ComponentRequest) =>
        changeLoops(ctx, "uninstall", () => api.uninstall(req)),
      ask: (_: restate.Context, req: ComponentRequest) => answer(() => api.ask(req)),
      workflowSave: (_: restate.Context, req: WorkflowSaveRequest) =>
        answer(() => api.workflowSave(req)),
      /** A failed spine step, again, waited on so the button says how it went. */
      retryEvent: (ctx: restate.Context, req: PortalRequest & { id?: unknown }) =>
        answer(async () => {
          const id = api.eventToRetry(req);
          const got = await ctx.serviceClient<SpineService>(SPINE).retry({ client: null, id });
          if (!got) throw new PortalRefusal("it isn't failed now", 409);
          return { done: [id], ...got };
        }),
      releaseHold: (_: restate.Context, req: PortalRequest & { id?: unknown }) =>
        answer(() => api.releaseHold(req)),
      question: (ctx: restate.Context, req: QuestionRequest) =>
        answer(() => ask(ctx, deps.main, req)),
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
