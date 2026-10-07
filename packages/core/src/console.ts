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
  atomic,
  CLIENT_ID,
  createDb,
  type Db,
  type Queryable,
  serializable,
  setAuditActor,
  snapshot,
} from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  can,
  type Permission,
  type RoleId,
  reach,
  type Target,
  TEAM_ROLES,
  WREN,
  whole,
} from "./access.js";
import { accessApi, accessHandlers } from "./access-console.js";
import { ACCESS_TYPES, accessRecords } from "./access-records.js";
import { ASK, type AskService, ask, type QuestionRequest } from "./ask.js";
import { release } from "./checks.js";
import {
  addClient,
  type Client,
  changeRecord,
  clients,
  clientUrl,
  isOwner,
  LastAdmin,
  normalEmail,
  removeTeamSeat,
  sendsWords,
  setTeamSeat,
  settingsFor,
  setWrenSettings,
  teamRecord,
  updateClient,
} from "./clients/index.js";
import { wrenSettings } from "./clients/schema.js";
import {
  ACCOUNT_SITES,
  ACCOUNTS,
  type AccountSite,
  CHANNELS,
  type Component,
  EVENT_KINDS,
  type LoopKey,
  type Port,
  STAGES,
} from "./components.js";
import { CONSOLE_APPS, CONSOLE_ROUTES } from "./console-routes.js";
import { type DryResult, dryStep, dryWalk, sampleEvent } from "./dry.js";
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
import { roleFits, spendGrant } from "./grants.js";
import { inHouseOfPart } from "./in-house.js";
import { accountsLacking, blockOf, has, installCheck, lacking } from "./installs.js";
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
import { LOGIC, logicOf, startWith } from "./logic.js";
import {
  accessOf,
  answer,
  isDemo,
  isOperator,
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
  named,
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
  type Fence,
  type GetAsk,
  type ListAsk,
  opens,
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
import {
  runs,
  type SentEvent,
  type WorkflowInstall,
  workflowInstalls,
  workflowSaves,
} from "./schema.js";
import { addAccount, factsHeld, factsLacking, type Setup, setupOf } from "./setup.js";
import {
  editsOf,
  type SavedWorkflow,
  SPINE,
  type SpineService,
  savedWorkflows,
  type WorkflowVersion,
  workflowHistory,
} from "./spine.js";
import {
  addSurvey,
  answerSurvey,
  pauseSurveys,
  removeSurveys,
  type SurveyInput,
  startSurveys,
  surveyRecord,
  surveysDue,
} from "./survey-store.js";
import { installDefaults } from "./template-defaults.js";
import {
  approveInstall,
  askTemplate,
  copyLabel,
  copyRefs,
  declineInstall,
  defaultsOnce,
  INSTALL_STATE_LABELS,
  installsOf,
  installTemplate,
  type Plan,
  parseInstallApprovalId,
  readPlan,
  type Template,
  installOf as templateInstallOf,
  templateNamed,
  templatesOf,
  uninstallTemplate,
} from "./template-install.js";
import { patchOf, WORKFLOW_ASK, workflowAskPrompt } from "./workflow-ask.js";
import {
  flowsWith,
  partsIn,
  portsOf,
  type Workflow,
  type WorkflowEdits,
  withEdits,
} from "./workflows.js";

/** One of the access types (`./access-records.ts`), served to anyone signed in there. */
const isAccess = (id: unknown) => (ACCESS_TYPES as readonly unknown[]).includes(id);

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
  role?: RoleId;
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
/** A template on a client (designs/2026-10-07-template-install.md). */
export interface TemplateRequest extends PortalRequest {
  template?: unknown;
  /** The template's id, typed, when it has effects. */
  confirm?: unknown;
  /** True once the plan of an update was read. */
  update?: unknown;
}
/** To approve items (`workflow:<id>`) a person approves or declines. */
export interface IdsRequest extends PortalRequest {
  ids?: unknown;
}

/** One of a client's accounts (`ACCOUNTS`), set by Wren's team; an empty `account` removes it. */
export interface ConnectRequest extends PortalRequest {
  site: string;
  account: string;
}

/** A workflow's routed wires and custom steps from the canvas; `reset` goes back to the code's. */
export interface WorkflowSaveRequest extends PortalRequest {
  workflow: string;
  wires?: unknown;
  steps?: unknown;
  reset?: boolean;
  /** The workflow's id, typed: a workflow with a node that sends, posts or spends needs it. */
  confirm?: string;
}

/** A dry test of a draft: from its first input, or one `node` at `port`; a sample or a real event. */
export interface WorkflowTestRequest extends PortalRequest {
  workflow: string;
  wires?: unknown;
  steps?: unknown;
  node?: unknown;
  port?: unknown;
  kind?: unknown;
  data?: unknown;
  /** Where a whole test enters: "in.<port>" or a trigger's "<node>.<port>". */
  from?: unknown;
  /** A real arrival's id: its data, pinned. */
  event?: unknown;
  /** What every rule answers; yes when left out. */
  rules?: unknown;
}

/**
 * What a workflow does outside Wren once live: every effect of every part in it, nested ones
 * too. Publishing one with any is William's yes (designs/2026-10-06-workflow-editor.md).
 */
export function workflowEffects(
  id: string,
  flows: readonly Workflow[],
  components: readonly Component[],
): string[] {
  return union(partsIn(id, flows, components).map((c) => c.effects));
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
      z
        .object({
          id: NAME,
          note: z.string().trim().max(200).optional(),
          /** A logic node, a trigger, or a part or workflow from the catalog. */
          uses: z.string().max(80).optional(),
          with: z
            .record(z.string().max(40), z.union([z.string().max(300), z.number()]))
            .refine((w) => Object.keys(w).length <= 12, "has too many settings")
            .optional(),
          own: z
            .object({
              name: z.string().trim().min(1).max(60),
              blurb: z.string().trim().max(200),
              icon: z.string().max(40),
              in: z.array(PORT).max(8),
              out: z.array(PORT).max(8),
              run: z.string().max(500),
            })
            .optional(),
        })
        .refine((s) => !s.uses !== !s.own, "is a custom step or uses one thing"),
    )
    .max(40),
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
  /**
   * The row the call is about (a record type and its id). A login without `run` over all of
   * Wren calls only that type's `calls`, on a row it may act on, with the input naming the row.
   */
  on?: { record?: unknown; id?: unknown };
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
    app: "loops",
    channel: null,
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
      service: named("Loop"),
      key: named("For"),
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
  app: "workflows",
  channel: null,
  name: { one: "event", many: "events" },
  view: "spine_events",
  key: "id",
  title: "subject",
  subtitle: "node",
  fields: {
    subject: text("About"),
    workflow: named("Workflow"),
    node: named("Node"),
    port: named("Port"),
    kind: named("Kind"),
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
  // What came in and what its step sent on: the canvas's node panel shows the last of them.
  load: async (db, id) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const rows = (await db.execute(
      sql`select data, sent, sent_at "sentAt" from events where id = ${id}::uuid`,
    )) as unknown as Array<{ data: unknown; sent: SentEvent[] | null; sentAt: unknown }>;
    const r = rows[0];
    return r
      ? {
          data: r.data,
          sent: r.sent,
          sentAt: r.sentAt ? new Date(r.sentAt as string).toISOString() : null,
        }
      : null;
  },
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
  app: "workflows",
  channel: null,
  name: { one: "execution", many: "executions" },
  view: "spine_executions",
  key: "id",
  title: "subject",
  subtitle: "workflow",
  fields: {
    subject: text("About"),
    workflow: named("Workflow"),
    kind: named("Kind"),
    state: status({
      failed: { label: "Failed", tone: "bad" },
      waiting: { label: "Waiting", tone: "neutral" },
      done: { label: "Done", tone: "good" },
    }),
    node: named("Now at"),
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
  app: "workflows",
  channel: null,
  name: { one: "hold", many: "holds" },
  view: "unit_holds_now",
  key: "id",
  title: "subject",
  subtitle: "stage",
  fields: {
    subject: text("What"),
    stage: named("Stage"),
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
  app: "workflows",
  channel: null,
  name: { one: "check", many: "checks" },
  view: "check_rates",
  key: "id",
  title: "check",
  subtitle: "source",
  fields: {
    check: text("Check"),
    stage: named("Stage"),
    source: named("Source"),
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
  /** A choice as people read it, by value ("first" is "First batch only"); from `.meta({ labels })`. */
  labels?: Readonly<Record<string, string>>;
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
  /** An enum's choices as people read them: `.meta({ labels })` on the zod enum. */
  labels?: Record<string, string>;
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

/** A day's key as its name: an hours block reads "Hours: Friday". */
const DAYS: Readonly<Record<string, string>> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
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
      const day = DAYS[name];
      const own = s.title ?? day ?? words(name);
      // A nested box reads "Stages: research", never "Stages.Research"; a day keeps its capital.
      const at = !label
        ? own
        : day
          ? `${label}: ${day}`
          : `${label}: ${own.charAt(0).toLowerCase()}${own.slice(1)}`;
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
        ...(s.enum && s.labels ? { labels: s.labels } : {}),
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
    app: "handlers",
    channel: null,
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

export { accountsLacking, lacking };

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

/** camelCase or snake_case as words: "minAdsPerAdset" is "min ads per adset". */
const wordsOf = (key: string) =>
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();

/** A code name a reader can't use: an env var, a module, a dotted key, a template ref. */
const CODE = /[A-Z]{2,}_|@wren\/|\b[a-z]\w*\.[a-z]\w*\b|#\d/;

/**
 * Where a guess is built, said in plain words for the page (`Guess.built` points at the code):
 * a setting by its form label, a niche field, a port, a part or an account by name. A pointer
 * only code reads gives null: the page says "Built" and no more.
 */
export function builtWords(
  c: Component,
  built: string,
  name: (id: string) => string | null,
): string | null {
  const settings = /^settings\.(.+)$/.exec(built);
  if (settings) {
    const labels = new Map((settingsForm(c) ?? []).map((f) => [f.field, f.label]));
    const keys = (settings[1] ?? "")
      .split(/,\s*/)
      .map((k) => k.replace(/^settings\./, ""))
      .filter((k) => /^\w+$/.test(k));
    const words = keys.map((k) => labels.get(k) ?? wordsOf(k));
    return words.length
      ? `${words.length > 1 ? "Settings" : "Setting"}: ${words.join(", ")}`
      : null;
  }
  const niche = /^niche\.(\w+)$/.exec(built);
  if (niche) return `The niche's ${wordsOf(niche[1] ?? "")}`;
  const port = /^(in|out)\.(\w+)$/.exec(built);
  if (port) {
    const p = (port[1] === "in" ? c.in : c.out).find((x) => x.id === port[2]);
    return p ? `${port[1] === "in" ? "Takes" : "Gives"} ${p.label}` : null;
  }
  const part = name(built);
  if (part) return part;
  if (CODE.test(built)) return null;
  const account = ACCOUNT_SITES.find((a) => new RegExp(`\\b${a}\\b`).test(built));
  const said = account ? built.replace(account, ACCOUNTS[account].label) : built;
  return said[0]?.toUpperCase() + said.slice(1);
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
    app: "loops",
    channel: null,
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

/** What a part provides, by kind, in its code names: "Services SearchWatch; Loops SearchWatch". */
const providesText = (p: Component["provides"]) =>
  (["services", "loops", "records", "apps"] as const)
    .filter((k) => p[k].length)
    .map((k) => `${k[0]?.toUpperCase()}${k.slice(1)} ${p[k].join(", ")}`)
    .join("; ") || null;

/**
 * The shop: every part in `all` and every workflow over them, each marked installed or not for
 * `client` when there is one (a workflow installs part by part until templates). The detail
 * carries ports, the hypothesis, what's inside and where it's used; the team's adds its settings
 * form, filled from the client's block. What a part provides is a System field, the team's.
 */
export const componentRecord = (
  all: readonly Component[],
  client: Client | null,
  team: boolean,
  workflows: readonly Workflow[] = [],
  /**
   * The client's live saves, why one was left out, and one workflow's draft and versions: the
   * team's, for the canvas's editing.
   */
  saves: {
    saved: Record<string, SavedWorkflow>;
    broken: Record<string, string[]>;
    /** Read on the load's own connection: a second one inside its snapshot can starve the pool. */
    history?: (
      db: Queryable,
      workflow: string,
    ) => Promise<{
      draft: WorkflowVersion | null;
      versions: WorkflowVersion[];
    }>;
    /** The workflows as the code has them, before any save: what a draft is checked over. */
    code?: readonly Workflow[];
  } = {
    saved: {},
    broken: {},
  },
  /**
   * The loop services running now, read when the list is: a part that runs for Wren with every
   * loop stopped reads "Off" to the team. Null or a failed read: no one is marked off.
   */
  running?: () => Promise<ReadonlySet<string>>,
  /**
   * The templates (`templatesOf` over the code's workflows), the client's installs of them, and
   * the plan of one for the team, read on the load's own connection.
   */
  sold: {
    list: readonly Template[];
    installs: readonly WorkflowInstall[];
    plan?: ((db: Queryable, t: Template) => Promise<Plan>) | undefined;
    /** The facts the client's accounts hold: null with no client. */
    facts?: ReadonlySet<string> | null;
    setups?: readonly Setup[];
  } = { list: [], installs: [] },
): RecordType => {
  // A setup is an account's, run from Accounts: never a card in the Shop.
  const flows = workflows.filter((w) => w.kind !== "setup" && (team || w.for === "client"));
  /** The facts a part needs that this client's accounts don't hold; none with no client. */
  const lacksFacts = (c: Component) => !!sold.facts && factsLacking(c, sold.facts).length > 0;
  /**
   * Each fact a part needs, said as an account ("Needs your account"), with the setup that makes
   * it true: its page links there.
   */
  const factAccounts = (c: Component) =>
    c.requires.facts.map((fact) => {
      const at = setupOf(fact, sold.setups ?? []);
      return {
        site: fact,
        label: at?.step.label ?? fact,
        holds: fact,
        how: at ? at.step.how : "Wren's team sets it up.",
        waits: at && at.step.who !== "client" ? at.step.forYou : null,
        any: false,
        has: sold.facts ? sold.facts.has(fact) : null,
        setup: at ? { id: at.setup.id, name: at.setup.name } : null,
        // The account it's on: that account's row reads "Saved", not "Connected", until it holds.
        of: at?.setup.site ?? null,
      };
    });
  /** A template stands in for the part or workflow it is: one card, never two. */
  const soldAs = new Set(sold.list.flatMap((t) => [t.id, t.workflow.id]));
  const installOf = (t: Template) => sold.installs.find((r) => r.template === t.id) ?? null;
  // A client sees one "In development" for both: built only for Wren, or not built at all.
  const shown = <R extends string>(r: R) => (!team && r === "coming" ? "planned" : r);
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
   * What the canvas's palette may add to `w`: logic nodes and triggers, then parts and workflows
   * from the catalog, a client's workflow only the client's. Each with its ports and effects.
   */
  const paletteFor = (w: Workflow) => ({
    logic: LOGIC.map((l) => ({
      id: l.id,
      name: l.name,
      blurb: l.blurb,
      icon: l.icon,
      group: l.group,
      ready: l.ready,
      settings: l.settings,
      start: startWith(l),
    })),
    parts: all
      .filter((c) => w.for === "wren" || c.for === "client")
      .map((c) => ({
        id: c.id,
        name: c.name,
        blurb: c.blurb,
        icon: c.icon,
        stage: c.stage,
        in: c.in,
        out: c.out,
        effects: c.effects,
        ready: readyOf(c),
      })),
    workflows: flows
      .filter((x) => x.id !== w.id && shownAs(x) === x && (w.for === "wren" || x.for === "client"))
      .map((x) => ({
        id: x.id,
        name: x.name,
        blurb: x.blurb,
        icon: x.icon,
        stage: x.stage,
        in: x.in,
        out: x.out,
        effects: union(partsIn(x.id, flows, all).map((c) => c.effects)),
        ready: flowReady(partsIn(x.id, flows, all)),
      })),
  });
  /**
   * What the canvas's editor opens on: the live save, its draft with what won't run in it, the
   * live versions for History, and the palette.
   */
  const editing = async (db: Queryable, w: Workflow) => {
    const h = saves.history ? await saves.history(db, w.id) : { draft: null, versions: [] };
    const code = saves.code ?? workflows;
    const raw = code.find((x) => x.id === w.id) ?? w;
    const draft = h.draft
      ? {
          ...h.draft,
          problems: h.draft.edits
            ? (flowsWith(code, { [w.id]: h.draft.edits }, all).broken[w.id] ?? [])
            : [],
        }
      : null;
    return {
      // The code's own routed wires: what "Back to built-in" and a version saved as it open on.
      code: { wires: raw.wires.filter((x) => x.via === "events"), steps: [] },
      saved: saves.saved[w.id] ?? null,
      broken: saves.broken[w.id] ?? [],
      draft,
      versions: h.versions,
      palette: paletteFor(w),
    };
  };
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
      const l = logicOf(n.uses);
      if (l)
        return {
          id: n.id,
          uses: l.id,
          ...l.ports(n.with ?? {}),
          name: l.name,
          note: n.note ?? l.says(n.with ?? {}),
          ready: l.ready ? "ready" : "planned",
          opens: null,
          count: null,
          with: n.with ?? {},
        };
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
        ...(n.with ? { with: n.with } : {}),
      };
    }),
    wires: w.wires.map((x) => {
      const [node = "", port = ""] = x.from.split(".");
      const n = w.nodes.find((y) => y.id === node);
      const uses = n?.uses;
      const outs =
        node === "in"
          ? w.in
          : (n?.own?.out ?? logicOf(uses)?.ports(n?.with ?? {}).out ?? portsOf(uses));
      const label = outs.find((p) => p.id === port)?.label ?? port;
      return { ...x, label, count: node === "in" ? null : countOf(uses, port) };
    }),
  });
  return defineRecord({
    id: COMPONENT,
    app: "marketplace",
    channel: null,
    name: { one: "component", many: "components" },
    rows: async () => {
      const on = team && running ? await running().catch(() => null) : null;
      const off = (c: Component) =>
        !!on &&
        readyOf(c) === "coming" &&
        c.provides.loops.length > 0 &&
        !c.provides.loops.some((l) => on.has(l));
      // Built for clients, but this client hasn't connected an account it needs, or a setup
      // hasn't made a fact it needs true (a lost fact moves an installed part back here too).
      const unconnected = (c: Component) =>
        !!client &&
        c.for === "client" &&
        readyOf(c) === "ready" &&
        ((!has(client, c.id) && accountsLacking(c, client).length > 0) || lacksFacts(c));
      return [
        ...sold.list.map((t) => {
          const parts = t.parts.map((p) => p.part);
          const row = installOf(t);
          const on = !!row && row.state !== "off";
          const behind = parts.filter((c) => !c.ready);
          // Built, but this client hasn't connected an account a part needs: it installs and waits.
          const waits =
            !!client &&
            flowReady(parts) === "ready" &&
            parts.some((c) => accountsLacking(c, client).length > 0 || lacksFacts(c));
          return {
            id: t.id,
            type: "template",
            name: t.name,
            blurb: t.blurb,
            icon: t.icon,
            stage: t.workflow.stage,
            channels: union(parts.map((c) => c.channels)).join(",") || null,
            for: "client",
            ready: waits ? "account" : shown(flowReady(parts)),
            installed: client ? (on ? "yes" : "no") : null,
            state: client ? (row?.state ?? null) : null,
            effects: t.effects.join(",") || null,
            instead: null,
            provides: null,
            needs: null,
            missing: behind.length
              ? `${behind.map((c) => c.name).join(", ")} ${behind.length > 1 ? "aren't" : "isn't"} ready`
              : null,
          };
        }),
        ...all
          .filter((c) => !soldAs.has(c.id))
          .map((c) => ({
            id: c.id,
            type: "part",
            name: c.name,
            blurb: c.blurb,
            icon: c.icon,
            stage: c.stage,
            channels: c.channels.join(",") || null,
            for: c.for,
            ready: off(c) ? "off" : unconnected(c) ? "account" : shown(readyOf(c)),
            // Wren's own parts are never on a client: no "not installed" for them.
            installed: client && c.for === "client" ? (has(client, c.id) ? "yes" : "no") : null,
            state: null,
            effects: c.effects.join(",") || null,
            // The SaaS it stands in for, quietly: its closest vendor's name only.
            instead: inHouseOfPart(c.id)?.instead[0]?.vendor ?? null,
            provides: team ? providesText(c.provides) : null,
            needs:
              [...c.requires.components, ...c.requires.accounts, ...c.requires.anyAccount].join(
                ", ",
              ) || null,
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
          .filter((w) => shownAs(w) === w && !soldAs.has(w.id))
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
              ready: shown(flowReady(parts)),
              installed: null,
              state: null,
              effects: union(parts.map((c) => c.effects)).join(",") || null,
              instead: null,
              provides: null,
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
      type: status(neutral({ template: "Template", part: "Part", workflow: "Workflow" }), "Type"),
      stage: status(neutral(STAGES), "Stage"),
      channels: tags(neutral(CHANNELS), "Channels"),
      ready: status(
        {
          ready: { label: "Ready", tone: "good" },
          // Built and running for Wren, not yet per client: the team sees it run, a client waits.
          coming: team
            ? { label: "Runs for Wren", tone: "good" }
            : { label: "In development", tone: "neutral" },
          planned: { label: "In development", tone: "neutral" },
          // Built per client; waits on an account this client hasn't connected.
          account: { label: "Needs your account", tone: "warn" },
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
      // A template on this client: installed as a draft, asked, live, or taken off.
      state: status(INSTALL_STATE_LABELS, "Template"),
      effects: tags(
        neutral({ sends: "Sends messages", spends: "Spends money", posts: "Posts publicly" }),
        "Effects",
      ),
      for: status(neutral({ client: "Clients", wren: "Wren's own" }), "For"),
      // Its code names, the team's: services and loops it runs. Folded under System.
      provides: text("Provides", { group: "System" }),
      icon: text("Icon", { group: "System" }),
      // Ids, for the Map's lines; the page says them in words under Needs and Accounts.
      needs: text("Needs", { group: "System" }),
      missing: text("Missing"),
    },
    views: [
      { id: "all", label: "All", sort: "name" },
      ...(client
        ? [{ id: "installed", label: "Installed", where: { installed: "yes" }, sort: "name" }]
        : []),
    ],
    load: async (db, id) => {
      const t = sold.list.find((x) => x.id === id);
      if (t) {
        const row = installOf(t);
        const w = flows.find((x) => x.id === t.workflow.id) ?? t.workflow;
        return {
          template: {
            id: t.id,
            effects: t.effects,
            door: t.spec.door ?? null,
            parts: t.parts.map(({ part: c, settings }) => ({
              id: c.id,
              name: c.name,
              blurb: c.blurb,
              effects: c.effects,
              ready: shown(readyOf(c)),
              settings: shownSettings(c, settings),
              labels: Object.fromEntries((settingsForm(c) ?? []).map((f) => [f.field, f.label])),
              accounts: [
                ...c.requires.accounts.map((site) => ({ site, any: false })),
                ...c.requires.anyAccount.map((site) => ({ site, any: true })),
              ]
                .map(({ site, any }) => ({
                  site: site as string,
                  ...ACCOUNTS[site],
                  any,
                  has: client ? !!client.accounts[site] : null,
                }))
                // Facts a setup leaves on an account, read as accounts: "Needs your account".
                .concat(factAccounts(c)),
            })),
            copy: copyRefs(t.copy, defaultsOnce()).map(({ ref, file }) => ({
              ref,
              label: copyLabel(ref),
              file,
            })),
          },
          workflow: drawn(w),
          usedIn: usedIn(t.id),
          install: row
            ? {
                id: row.id,
                state: row.state,
                current: row.version === t.version,
                by: row.by,
                at: row.at.toISOString(),
                askedBy: row.askedBy,
                approvedBy: row.approvedBy,
                approvedAt: row.approvedAt?.toISOString() ?? null,
              }
            : null,
          plan: team && client && sold.plan ? await sold.plan(db, t) : null,
        };
      }
      const w = flows.find((x) => x.id === id);
      if (w)
        return {
          workflow: drawn(w),
          usedIn: usedIn(id),
          ...(team ? await editing(db, w) : {}),
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
        ],
        // Each account: how the client connects it, what waits on Wren, and its value for the team.
        accounts: [
          ...c.requires.accounts.map((site) => ({ site, any: false })),
          ...c.requires.anyAccount.map((site) => ({ site, any: true })),
        ]
          .map(({ site, any }) => ({
            site: site as string,
            ...ACCOUNTS[site],
            // One of the any is enough: the part needs a channel, not every one.
            any,
            has: client ? !!client.accounts[site] : null,
            ...(team && client ? { account: client.accounts[site] ?? null } : {}),
          }))
          .concat(factAccounts(c)),
        effects: c.effects,
        // Read-only: only an admin turns a client's sends on, from the CLI.
        sends: client && c.liveSwitch ? sendsWords(client, c.id) : null,
        installed,
        in: c.in,
        out: c.out,
        hypothesis: {
          ...c.hypothesis,
          guesses: c.hypothesis.guesses.map((g) =>
            g.is !== "fixed" && g.built
              ? {
                  ...g,
                  where: builtWords(c, g.built, (to) => all.find((x) => x.id === to)?.name ?? null),
                }
              : g,
          ),
        },
        inside: inside ? drawn(inside) : null,
        usedIn: usedIn(id),
        ...(team
          ? {
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
  setups = [],
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
  /** Account setups (`SETUPS` in the worker): a template's plan says how to make a missing fact. */
  setups?: readonly Setup[];
}) {
  const allowed = new Set([...views, ...moneyViews]);
  const money = new Set(moneyViews);
  /** The workflows sold as templates, from the code's wiring. */
  const sold = templatesOf(workflows, components);
  /** The client's own database for one call, or null when this worker can't reach it. */
  const onClientDb = async <T>(
    client: Pick<Client, "id" | "database">,
    fn: (db: Queryable | null) => Promise<T>,
  ): Promise<T> => {
    if (!mainUrl) return fn(null);
    const handle = createDb(clientUrl(mainUrl, client), { max: 1, app: "wren-console" });
    try {
      return await fn(handle.db);
    } finally {
      await handle.close();
    }
  };
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
    surveyRecord(edge),
    workflowRecord(workflows, components),
    eventRecord,
    executionRecord,
    holdRecord,
    checkRecord,
  ];
  /** The workflow a canvas call names, for Wren or a client it may write, and who's asking. */
  const workflowFor = async (req: WorkflowSaveRequest) => {
    team(req);
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    // No client is Wren's own, as the catalog reads it.
    const client = req.client ? (await pickForWrite(main, req)).client.id : null;
    const w = workflows.find((x) => x.id === req.workflow);
    if (!w) throw new PortalRefusal("no such workflow", 404);
    if (client && w.for === "wren") throw new PortalRefusal("that runs Wren's own business", 409);
    return { w, client, by: (req.viewer as SignedViewer).email };
  };
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
  /** An experiment button's writer (`manage` at Wren) and the flags it names. */
  const experimentIds = (req: PortalRequest & { ids?: unknown }): [string, string[]] => {
    const by = teamWriter(req);
    if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
    const ids = Array.isArray(req.ids) ? req.ids.filter((x) => typeof x === "string") : [];
    if (!ids.length) throw new PortalRefusal("say which experiment", 400);
    return [by, ids];
  };
  /** The rows of each of Wren's types this teammate may read; the catalog is everyone's. */
  const fenceOf =
    (req: PortalRequest): Fence =>
    (t) =>
      t.id === COMPONENT || isAccess(t.id)
        ? null
        : reach(accessOf(req), "read", {
            client: WREN,
            app: t.app,
            type: t.id,
            channel: t.channel,
          });
  /**
   * Where one row is, as a check's target: its app, its channel (the type's, or the row's own
   * when it keeps one), and the row itself. Null when the row isn't there.
   */
  const rowAt = async (t: RecordType, id: string): Promise<Target | null> => {
    const at = { client: WREN, app: t.app, record: `${t.id}:${id}` };
    if (t.channel === null || typeof t.channel === "string") return { ...at, channel: t.channel };
    const field = t.channel.field;
    const got = await serveRecords([t], main)
      .get({ record: t.id, id })
      .catch(() => null);
    if (!got) return null;
    const c = got.row[field];
    return { ...at, channel: typeof c === "string" ? c : null };
  };
  /**
   * The verb this teammate does a row's `needs` with: `needs` itself, or `act` on that row when
   * `needs` is `run` (a login limited to an app or channel works its own rows). Null: neither.
   */
  const verbAt = (req: PortalRequest, needs: Permission, at: Target): Permission | null =>
    teamCan(req, needs, at) ? needs : needs === "run" && teamCan(req, "act", at) ? "act" : null;
  /**
   * The team's types and the catalog, or the catalog alone for anyone else: what a client can
   * have, marked installed for the client picked.
   */
  const typesFor = async (req: PortalRequest): Promise<RecordType[]> => {
    const internal = seesInternal(req);
    const client =
      (req.client && req.client !== WREN) || !internal ? await pickClient(main, req) : null;
    const shown = internal ? components : components.filter((c) => c.for === "client");
    // Wren's own records, each for whoever holds what it needs at Wren (Money: `money`) in its
    // app. Which rows, and whether any, is the fence's (`read`).
    const allowed = internal
      ? types.filter((t) => !t.needs || teamCan(req, t.needs, { client: WREN, app: t.app }))
      : [];
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
    // Roles, grants, issues and asks in this workspace, as this login reads them.
    const access =
      !isDemo(req.viewer) && (asked === undefined || isAccess(asked))
        ? accessRecords({
            // What the guard read; a login called straight is read fresh.
            who:
              (req.viewer as SignedViewer).access || isOperator(req.viewer)
                ? accessOf(req)
                : await whoIs(main, req.viewer, client?.id),
            email: (req.viewer as SignedViewer).email,
            client: client?.id ?? WREN,
          })
        : [];
    return [
      ...mine,
      ...access,
      componentRecord(
        shown,
        client,
        internal,
        flows,
        {
          saved,
          broken,
          history: (db, wf) => workflowHistory(db, client?.id ?? null, wf),
          code: workflows,
        },
        internal && admin ? runningLoops(admin) : undefined,
        {
          list: sold,
          installs: client ? await installsOf(main, client.id) : [],
          plan:
            internal && client
              ? (db, t) =>
                  onClientDb(client, (cdb) => readPlan(db, cdb, t, client.id, undefined, setups))
              : undefined,
          facts: client ? await factsHeld(main, client.id) : null,
          setups,
        },
      ),
    ];
  };
  /**
   * Records on the main database, read-only, unmasked: the team sees each type's rows its
   * grants reach (every row for a built-in role).
   */
  const read = async <T>(
    req: PortalRequest & { record?: unknown },
    use: (api: RecordsApi) => Promise<T>,
  ): Promise<T> => {
    if (req.record !== COMPONENT && !isAccess(req.record)) team(req);
    const all = await typesFor(req);
    return snapshot(main, (tx) => use(serveRecords(all, tx, undefined, fenceOf(req))));
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
    const id = typeof req.id === "string" || typeof req.id === "number" ? String(req.id) : "";
    if (!id || id.length > 200) throw new PortalRefusal("say which one", 400);
    const at = await rowAt(t, id);
    if (!at) throw new PortalRefusal(`no such ${t.name.one}`, 404);
    const verb = verbAt(req, needs, at);
    if (!verb) throw new PortalRefusal(`changing these needs ${needs}`, 403);
    return { t, id, at, verb, by: (req.viewer as SignedViewer).email };
  };
  /** An edit or undo in one transaction, audited as the teammate's. */
  const write = async <T>(
    req: PortalRequest & { record?: unknown; id?: unknown },
    change: (tx: Queryable, t: RecordType, id: string, by: string) => Promise<T>,
  ): Promise<T> => {
    const { t, id, at, verb, by } = await editable(req);
    return serializable(main, async (tx) => {
      await setAuditActor(tx, by);
      // A counted grant is spent with the write, so a one-use grant can't be used twice.
      await spendGrant(tx, accessOf(req), verb, at);
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
      // The default templates it reads go into the client's database, following the default.
      if (verb === "install" && c.provides.templates.length && mainUrl) {
        const handle = createDb(clientUrl(mainUrl, client), { max: 1, app: "wren-console" });
        try {
          await installDefaults(handle.db, c.provides.templates, { by });
        } finally {
          await handle.close();
        }
      }
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
    // A loop two parts share (ReachWatch for comments and invites) stops with the last of them.
    const others = components
      .filter((x) => x.id !== c.id && x.id in client.products)
      .flatMap((x) => {
        const parsed = x.settings.safeParse(client.products[x.id]);
        return parsed.success
          ? x.clientLoops(client.id, parsed.data as Record<string, unknown>)
          : [];
      });
    const kept = new Set([...start, ...others].map(id));
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
    ...accessApi({ main, typesFor, rowAt }),
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

    recordsTypes: async (req: PortalRequest): Promise<RecordMeta[]> => {
      const fence = fenceOf(req);
      return (await typesFor(req)).filter((t) => opens(t, fence(t))).map((t) => metaOf(t, false));
    },
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
    /** Surveys: Go live puts a site survey on the public site, so `manage` (William). */
    surveyAdd: async (req: PortalRequest & SurveyInput) => {
      const by = teamWriter(req);
      if (!teamCan(req, "manage", WREN)) throw new PortalRefusal("your role can't do that", 403);
      const { key, question, kind, choices, surface } = req;
      return addSurvey(main, { key, question, kind, choices, surface }, by);
    },
    surveyStart: async (req: PortalRequest & { ids?: unknown }) => {
      const [by, ids] = experimentIds(req);
      return { done: await startSurveys(main, ids, by, edge) };
    },
    surveyPause: async (req: PortalRequest & { ids?: unknown }) => {
      const [, ids] = experimentIds(req);
      return { done: await pauseSurveys(main, ids, edge) };
    },
    surveyRemove: async (req: PortalRequest & { ids?: unknown }) => {
      const [, ids] = experimentIds(req);
      return { done: await removeSurveys(main, ids) };
    },
    /** A client login's portal surveys on its client; the team and the demo get none. */
    surveysDue: async (req: PortalRequest) => {
      if (isDemo(req.viewer) || seesInternal(req)) return [];
      const client = await pickClient(main, req);
      return surveysDue(main, client.id, (req.viewer as SignedViewer).email);
    },
    surveyAnswer: async (req: PortalRequest & { survey?: unknown; value?: unknown }) => {
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      if (seesInternal(req)) throw new PortalRefusal("surveys are for client logins", 403);
      if (typeof req.survey !== "string") throw new PortalRefusal("say which survey", 400);
      const client = await pickClient(main, req);
      return answerSurvey(main, {
        survey: req.survey,
        client: client.id,
        person: (req.viewer as SignedViewer).email,
        value: req.value,
      });
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
        if (role !== undefined && (typeof role !== "string" || !(await roleFits(tx, role, WREN))))
          throw new PortalRefusal(`role: one of ${TEAM_ROLES.join(", ")}, or one of Wren's`, 400);
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
      change(req, "install", (c, client) =>
        installCheck(c, client, { settings: req.settings, confirm: req.confirm }),
      ),
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
    /** What installing a template on the client would do, read before anything is written. */
    async templatePlan(req: TemplateRequest): Promise<Plan> {
      team(req);
      const t = templateNamed(sold, req.template);
      const client = await pickClient(main, req);
      return onClientDb(client, (db) => readPlan(main, db, t, client.id, undefined, setups));
    },
    /**
     * A template onto a client in one go: parts, copy, the draft and its shut door. Installing
     * again changes nothing; after the template moved, `update` applies the plan's changes.
     * Starts nothing: loops start once a person approves it.
     */
    async templateInstall(req: TemplateRequest) {
      team(req);
      const t = templateNamed(sold, req.template);
      const client = await pickClient(main, req);
      const by = (req.viewer as SignedViewer).email;
      const run = await openRun(main, {
        command: `console template ${t.id}`.slice(0, 64),
        argv: { by, client: client.id, update: req.update === true },
      });
      try {
        const out = await onClientDb(client, (db) =>
          installTemplate(main, db, t, {
            client: client.id,
            by,
            confirm: req.confirm,
            update: req.update === true,
            setups,
          }),
        );
        await finishRun(main, run.id, { ok: true });
        return out;
      } catch (err) {
        await finishRun(main, run.id, { error: String(err).slice(0, 500) });
        throw err;
      }
    },
    /** Publish: the client's workflow goes to To approve; a person's yes makes it live. */
    async templatePublish(req: TemplateRequest) {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const t = templateNamed(sold, req.template);
      const client = await pickClient(main, req);
      return askTemplate(main, t, { client: client.id, by: (req.viewer as SignedViewer).email });
    },
    /** Off the client: its loops stop, the door shuts; data, copy and saves stay. */
    async templateUninstall(req: TemplateRequest) {
      team(req);
      const t = templateNamed(sold, req.template);
      const client = await pickClient(main, req);
      const out = await uninstallTemplate(
        main,
        t,
        { client: client.id, by: (req.viewer as SignedViewer).email },
        { workflows, components },
      );
      return { ...out, start: [], stop: out.stop.filter((l) => bound(l.service)) };
    },
    /**
     * A person's yes on To approve (`workflow:<id>`): the draft goes live, the door opens, the
     * parts' loops start. Sending needs `effect`, spending `money`, at Wren.
     */
    async templateApprove(req: IdsRequest) {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("only a person approves", 403);
      const by = (req.viewer as SignedViewer).email;
      const ids = Array.isArray(req.ids) ? req.ids : [];
      if (!ids.length || ids.some((x) => parseInstallApprovalId(x) === null))
        throw new PortalRefusal("nothing picked", 404);
      const done: string[] = [];
      const start: LoopKey[] = [];
      for (const id of ids) {
        const [row] = await main
          .select()
          .from(workflowInstalls)
          .where(eq(workflowInstalls.id, parseInstallApprovalId(id) as number));
        if (!row) throw new PortalRefusal("no such item", 404);
        const t = templateNamed(sold, row.template);
        if (t.effects.some((e) => e !== "spends") && !teamCan(req, "effect", WREN))
          throw new PortalRefusal("it sends: only an admin can make it live", 403);
        if (t.effects.includes("spends") && !teamCan(req, "money", WREN))
          throw new PortalRefusal("it spends: only an admin can make it live", 403);
        const out = await approveInstall(main, id, { by, workflows, components });
        done.push(out.id);
        start.push(...out.start.filter((l) => bound(l.service)));
      }
      return { done, start, stop: [] as LoopKey[] };
    },
    /** A person's no: back to a draft, nothing ran. */
    async templateDecline(req: IdsRequest) {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("only a person declines", 403);
      const ids = Array.isArray(req.ids) ? req.ids : [];
      if (!ids.length) throw new PortalRefusal("nothing picked", 404);
      const done: string[] = [];
      for (const id of ids)
        done.push((await declineInstall(main, id, (req.viewer as SignedViewer).email)).id);
      return { done };
    },
    /** A client's templates and where each stands: the client's page reads it. */
    async templateInstalls(req: PortalRequest) {
      const client = await pickClient(main, req);
      return (await installsOf(main, client.id)).map((r) => {
        const t = sold.find((x) => x.id === r.template);
        return {
          template: r.template,
          name: t?.name ?? r.template,
          state: r.state,
          current: t ? r.version === t.version : false,
          parts: r.applied.added.length,
          at: r.at.toISOString(),
          by: r.by,
        };
      });
    },
    /**
     * One account onto a client, from the Shop: the team's, with `manage` there, audited and a runs
     * row. Empty takes it off, refused while an installed part needs it. Nothing signs in.
     */
    async connect(req: ConnectRequest): Promise<{ client: string; site: string; set: boolean }> {
      team(req);
      const site = ACCOUNT_SITES.find((s) => s === req.site) as AccountSite | undefined;
      if (!site) throw new PortalRefusal("no such account", 404);
      if (typeof req.account !== "string") throw new PortalRefusal("account: text", 400);
      const account = req.account.trim();
      if (account.length > 200) throw new PortalRefusal("account: 200 characters at most", 400);
      const client = await pickClient(main, req);
      if (!account) {
        const rest = { ...client.accounts, [site]: "" };
        const users = components.filter(
          (c) => has(client, c.id) && accountsLacking(c, { accounts: rest }).length > 0,
        );
        if (users.length)
          throw new PortalRefusal(
            `${users.map((c) => c.name).join(", ")} need${users.length === 1 ? "s" : ""} it: uninstall that first`,
            409,
          );
      }
      const by = (req.viewer as SignedViewer).email;
      const run = await openRun(main, {
        command: `console connect ${site}`.slice(0, 64),
        argv: { by, client: client.id, set: !!account },
      });
      try {
        await serializable(main, async (tx) => {
          await setAuditActor(tx, by);
          await updateClient(tx, client.id, { accounts: { [site]: account } });
        });
        // The registry keeps it too, so Accounts lists it and a setup can start on it.
        if (account) await addAccount(main, { client: client.id, site, ref: account, by });
      } catch (err) {
        await finishRun(main, run.id, { error: String(err).slice(0, 500) });
        throw err;
      }
      await finishRun(main, run.id, { ok: true });
      return { client: client.id, site, set: !!account };
    },
    /**
     * A workflow's draft from the canvas, for Wren or a client: kept as it reads, whether or not
     * it would run, with what won't. It runs nowhere until Publish. A client gets only workflows
     * for clients.
     */
    async workflowSave(req: WorkflowSaveRequest): Promise<{ id: number; problems: string[] }> {
      const { w, client, by } = await workflowFor(req);
      let edits: WorkflowEdits | null = null;
      if (!req.reset) {
        const got = EDITS.safeParse({ wires: req.wires, steps: req.steps });
        if (!got.success) {
          const i = got.error.issues[0];
          throw new PortalRefusal(`that doesn't read: ${i?.path.join(".")} ${i?.message}`, 400);
        }
        edits = got.data as WorkflowEdits;
      }
      const problems = edits
        ? (flowsWith(workflows, { [w.id]: edits }, components).broken[w.id] ?? [])
        : [];
      const id = await atomic(main, async (tx) => {
        // One draft at a time: the newer one replaces it.
        await tx.execute(sql`DELETE FROM workflow_saves WHERE NOT live AND workflow = ${w.id}
          AND client IS NOT DISTINCT FROM ${client}`);
        const [row] = await tx
          .insert(workflowSaves)
          .values({ client, workflow: w.id, edits, live: false, by })
          .returning({ id: workflowSaves.id });
        return row?.id ?? 0;
      });
      return { id, problems };
    },
    /**
     * Publish: the draft goes live, checked as the spine would run it. A workflow with a part that
     * sends needs `effect`, one that spends `money`, and either needs its id typed back. Subjects
     * already in it keep the wiring they entered on.
     */
    async workflowPublish(req: WorkflowSaveRequest): Promise<{ id: number; asked?: string }> {
      const { w, client, by } = await workflowFor(req);
      // A client's template: publishing asks in To approve; a person's yes makes it live.
      const t = client ? sold.find((x) => x.workflow.id === w.id) : undefined;
      const row = t && client ? await templateInstallOf(main, client, t.id) : null;
      if (t && client && row && row.state !== "off") {
        const asked = await askTemplate(main, t, { client, by });
        return { id: 0, asked: asked.id };
      }
      const { draft } = await workflowHistory(main, client, w.id);
      if (!draft) throw new PortalRefusal("there's no draft to publish", 409);
      const next = flowsWith(workflows, draft.edits ? { [w.id]: draft.edits } : {}, components);
      const bad = next.broken[w.id];
      if (bad) throw new PortalRefusal(bad.join("; "), 400);
      const effects = workflowEffects(w.id, next.flows, components);
      if (effects.some((e) => e !== "spends") && !teamCan(req, "effect", WREN))
        throw new PortalRefusal("it sends: only an admin can make it live", 403);
      if (effects.includes("spends") && !teamCan(req, "money", WREN))
        throw new PortalRefusal("it spends: only an admin can make it live", 403);
      if (effects.length && req.confirm !== w.id)
        throw new PortalRefusal(`it ${effects.join(" and ")}: type ${w.id} to confirm`, 400);
      return atomic(main, async (tx) => {
        const [row] = await tx
          .insert(workflowSaves)
          .values({ client, workflow: w.id, edits: draft.edits, live: true, by })
          .returning({ id: workflowSaves.id });
        await tx.execute(sql`DELETE FROM workflow_saves WHERE NOT live AND workflow = ${w.id}
          AND client IS NOT DISTINCT FROM ${client}`);
        return { id: row?.id ?? 0 };
      });
    },
    /** The draft dropped: the live wiring stays as it is. */
    async workflowDiscard(req: WorkflowSaveRequest): Promise<{ done: number }> {
      const { w, client } = await workflowFor(req);
      const gone = (await main.execute(sql`DELETE FROM workflow_saves WHERE NOT live
        AND workflow = ${w.id} AND client IS NOT DISTINCT FROM ${client}
        RETURNING id`)) as unknown as unknown[];
      return { done: gone.length };
    },
    /**
     * Ask Claude on the graph: the run row holding the prompt, for `Ask/edit` to answer with the
     * next draft. Nothing changes until he accepts it and publishes.
     */
    async workflowAskOpen(req: WorkflowSaveRequest & { message?: unknown }): Promise<string> {
      const { w, client, by } = await workflowFor(req);
      const message = typeof req.message === "string" ? req.message.trim() : "";
      if (!message) throw new PortalRefusal("say what to change", 400);
      if (message.length > ASK_MESSAGE_MAX)
        throw new PortalRefusal(`keep it under ${ASK_MESSAGE_MAX} characters`, 400);
      const got = EDITS.safeParse({ wires: req.wires ?? [], steps: req.steps ?? [] });
      const draft = got.success ? (got.data as WorkflowEdits) : { wires: [], steps: [] };
      const flows = workflows.filter(
        (x) => x.id !== w.id && (w.for === "wren" || x.for === "client"),
      );
      const prompt = workflowAskPrompt({
        w: withEdits(w, draft),
        draft,
        parts: components.filter((c) => w.for === "wren" || c.for === "client"),
        flows,
        message,
      });
      const argv = { record: WORKFLOW_ASK, id: `${client ?? ""}:${w.id}`, by, message, ...prompt };
      return (await openRun(main, { command: ASK_COMMAND, argv, model: "claude-code:sonnet" })).id;
    },
    /** Claude's answer on the graph, while the canvas waits: thinking, or its reply and draft. */
    async workflowAnswer(req: PortalRequest & { id?: unknown }) {
      team(req);
      const id = typeof req.id === "string" && /^[0-9a-f-]{36}$/.test(req.id) ? req.id : "";
      if (!id) throw new PortalRefusal("no such ask", 404);
      const [row] = await main
        .select({ argv: runs.argv, stats: runs.stats, finishedAt: runs.finishedAt })
        .from(runs)
        .where(
          and(
            eq(runs.id, id),
            eq(runs.command, ASK_COMMAND),
            sql`${runs.argv}->>'record' = ${WORKFLOW_ASK}`,
          ),
        );
      if (!row) throw new PortalRefusal("no such ask", 404);
      const stats = (row.stats ?? {}) as { reply?: string; patch?: unknown; error?: string };
      if (!row.finishedAt) return { state: "thinking" as const };
      if (stats.error) return { state: "failed" as const, error: stats.error };
      return {
        state: "done" as const,
        reply: stats.reply ?? "",
        patch: patchOf(stats.patch),
      };
    },

    /**
     * Test the draft, dry (`./dry.ts`): the whole workflow from an input, or one node. On a
     * sample event, or a real arrival's data read from `events`. Nothing is claimed or sent.
     */
    async workflowTest(req: WorkflowTestRequest): Promise<DryResult> {
      team(req);
      const w = workflows.find((x) => x.id === req.workflow);
      if (!w) throw new PortalRefusal("no such workflow", 404);
      const got = EDITS.safeParse({ wires: req.wires ?? [], steps: req.steps ?? [] });
      if (!got.success) throw new PortalRefusal("that draft doesn't read", 400);
      const { flows, broken } = flowsWith(
        workflows,
        { [w.id]: got.data as WorkflowEdits },
        components,
      );
      if (broken[w.id]) throw new PortalRefusal(`it won't run: ${broken[w.id]?.join("; ")}`, 400);
      const map = new Map(flows.map((f) => [f.id, f]));
      const flow = map.get(w.id) as Workflow;
      const node = typeof req.node === "string" ? req.node : null;
      // Where a whole test enters: one of its inputs, or a trigger's output ("node.port").
      const from = node
        ? null
        : typeof req.from === "string"
          ? req.from
          : flow.in[0]
            ? `in.${flow.in[0].id}`
            : null;
      const [head = "", out = ""] = from?.split(".") ?? [];
      const source = flow.nodes.find((n) => n.id === head);
      const entry = from
        ? (head === "in"
            ? flow.in
            : source
              ? (portsOf(source, new Map(components.map((c) => [c.id, c])), map)?.out ?? [])
              : []
          ).find((p) => p.id === out)
        : undefined;
      if (from && !entry) throw new PortalRefusal("no such input", 400);
      const port = node ? (typeof req.port === "string" ? req.port : undefined) : out;
      if (!port) throw new PortalRefusal("say which input", 400);
      const kindIn =
        entry?.kind ??
        (typeof req.kind === "string" && req.kind in EVENT_KINDS
          ? (req.kind as Port["kind"])
          : "lead");
      const data =
        req.data && typeof req.data === "object" && !Array.isArray(req.data)
          ? (req.data as Record<string, unknown>)
          : {};
      let event = sampleEvent(kindIn, data);
      // A real arrival's data, pinned: read only, on the team's main database.
      if (typeof req.event === "string") {
        if (!/^[0-9a-f-]{36}$/.test(req.event)) throw new PortalRefusal("no such event", 404);
        const [row] = (await main.execute(sql`SELECT subject, kind, data FROM events
          WHERE id = ${req.event}::uuid`)) as unknown as Array<typeof event>;
        if (!row) throw new PortalRefusal("no such event", 404);
        event = row;
      }
      const base = {
        flows: map,
        parts: new Map(components.map((c) => [c.id, c])),
        workflow: w.id,
        client: null,
        rules: req.rules !== false,
      };
      return node
        ? dryStep({ ...base, node, port, event })
        : dryWalk({ ...base, from: from as string, events: [event] });
    },

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
    /**
     * Whether this teammate may make this call: anyone with `run` over all of Wren may; anyone
     * else only a call its row's type declares, naming that row, on a row they may act on. A
     * counted grant is spent here, in its own transaction, before the call goes out.
     */
    async callOn(req: CallRequest, h: HandlerRow): Promise<void> {
      if (whole(accessOf(req), "run", WREN)) return;
      const on = req.on;
      const record = typeof on?.record === "string" ? on.record : "";
      const id = typeof on?.id === "string" || typeof on?.id === "number" ? String(on.id) : "";
      if (!record || !id) throw new PortalRefusal("your role can't do that", 403);
      const t = (await typesFor(req)).find((x) => x.id === record);
      if (!t) throw new PortalRefusal("no such record", 404);
      const key = t.calls?.[`${h.service}/${h.handler}`];
      if (!key) throw new PortalRefusal(`your role can't do that on ${t.name.many}`, 403);
      if (!names((req.input as Record<string, unknown> | undefined)?.[key], id))
        throw new PortalRefusal("that call isn't about this row", 400);
      const at = await rowAt(t, id);
      if (!at) throw new PortalRefusal(`no such ${t.name.one}`, 404);
      const verb = verbAt(req, "run", at);
      if (!verb) throw new PortalRefusal("your role can't do that here", 403);
      await serializable(main, async (tx) => {
        await setAuditActor(tx, (req.viewer as SignedViewer).email);
        await spendGrant(tx, accessOf(req), verb, at);
      });
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

/**
 * Does a handler's input value name row `id`: the id itself, or a list of just it. A row id may
 * carry its kind ("draft:3"); the input names the bare id.
 */
function names(v: unknown, id: string): boolean {
  const bare = id.slice(id.indexOf(":") + 1);
  const one = Array.isArray(v) ? (v.length === 1 ? v[0] : undefined) : v;
  return (
    (typeof one === "string" || typeof one === "number") &&
    (String(one) === id || String(one) === bare)
  );
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
    apps: CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      ...accessHandlers(api),
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
      surveyAdd: (ctx: restate.Context, req: PortalRequest & SurveyInput) =>
        answer(() => ctx.run("add survey", () => answer(() => api.surveyAdd(req)))),
      surveyStart: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("start survey", () => answer(() => api.surveyStart(req)))),
      surveyPause: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("pause survey", () => answer(() => api.surveyPause(req)))),
      surveyRemove: (ctx: restate.Context, req: PortalRequest & { ids?: unknown }) =>
        answer(() => ctx.run("remove survey", () => answer(() => api.surveyRemove(req)))),
      surveysDue: (_: restate.Context, req: PortalRequest) => answer(() => api.surveysDue(req)),
      surveyAnswer: (
        ctx: restate.Context,
        req: PortalRequest & { survey?: unknown; value?: unknown },
      ) => answer(() => ctx.run("answer survey", () => answer(() => api.surveyAnswer(req)))),
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
          await ctx.run("check row", () => answer(() => api.callOn(req, h)));
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
      templatePlan: (_: restate.Context, req: TemplateRequest) =>
        answer(() => api.templatePlan(req)),
      // Journaled once: a retry reads the same answer, and the door's token is never made twice.
      templateInstall: (ctx: restate.Context, req: TemplateRequest) =>
        answer(() => ctx.run("install template", () => answer(() => api.templateInstall(req)))),
      templatePublish: (ctx: restate.Context, req: TemplateRequest) =>
        answer(() => ctx.run("ask approval", () => answer(() => api.templatePublish(req)))),
      templateUninstall: (ctx: restate.Context, req: TemplateRequest) =>
        changeLoops(ctx, "uninstall template", () => api.templateUninstall(req)),
      templateApprove: (ctx: restate.Context, req: IdsRequest) =>
        changeLoops(ctx, "approve template", () => api.templateApprove(req)),
      templateDecline: (ctx: restate.Context, req: IdsRequest) =>
        answer(() => ctx.run("decline template", () => answer(() => api.templateDecline(req)))),
      templateInstalls: (_: restate.Context, req: PortalRequest) =>
        answer(() => api.templateInstalls(req)),
      connect: (ctx: restate.Context, req: ConnectRequest) =>
        answer(() => ctx.run("connect", () => answer(() => api.connect(req)))),
      workflowSave: (ctx: restate.Context, req: WorkflowSaveRequest) =>
        answer(() => ctx.run("save draft", () => answer(() => api.workflowSave(req)))),
      workflowPublish: (ctx: restate.Context, req: WorkflowSaveRequest) =>
        answer(() => ctx.run("publish", () => answer(() => api.workflowPublish(req)))),
      workflowDiscard: (ctx: restate.Context, req: WorkflowSaveRequest) =>
        answer(() => ctx.run("discard draft", () => answer(() => api.workflowDiscard(req)))),
      workflowAsk: (ctx: restate.Context, req: WorkflowSaveRequest & { message?: unknown }) =>
        answer(async () => {
          const id = await ctx.run("open run", () => answer(() => api.workflowAskOpen(req)));
          ctx.serviceSendClient<AskService>(ASK).edit({ id });
          return { id };
        }),
      workflowAnswer: (_: restate.Context, req: PortalRequest & { id?: unknown }) =>
        answer(() => api.workflowAnswer(req)),
      workflowTest: (_: restate.Context, req: WorkflowTestRequest) =>
        answer(() => api.workflowTest(req)),
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
