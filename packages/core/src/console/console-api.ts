/**
 * `consoleApi`: every ConsolePortal handler as a plain function over the deps the worker
 * passes in, with the request shapes and schemas they take and `consoleTypes`, the record
 * types the console serves. `makeConsolePortal` (`./console-portal.ts`) binds them.
 */
import { randomUUID } from "node:crypto";
import {
  atomic,
  CLIENT_ID,
  createDb,
  type Db,
  type Queryable,
  serializable,
  setAuditActor,
  snapshot,
  type Tx,
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
} from "../access.js";
import { accessApi } from "../access-console.js";
import { ACCESS_TYPES, accessRecords } from "../access-records.js";
import type { AskContext } from "../ask.js";
import { automationRecord } from "../automations.js";
import { release } from "../checks.js";
import {
  addClient,
  type Client,
  changeRecord,
  clients,
  clientUrl,
  findClient,
  isOwner,
  LastAdmin,
  normalEmail,
  removeTeamSeat,
  setTeamSeat,
  settingsFor,
  setWrenSettings,
  teamRecord,
  updateClient,
} from "../clients/index.js";
import {
  ACCOUNT_SITES,
  type AccountSite,
  type Component,
  EVENT_KINDS,
  type LoopKey,
  type Port,
  STAGES,
} from "../components.js";
import { customApi } from "../custom-console.js";
import { withCustomFields } from "../custom-fields.js";
import { decideStats, type KindStats } from "../decide/stats.js";
import { leadOf } from "../door.js";
import { type Door, doorsFor, ensureDoors, revealDoor, rotateDoor } from "../doors.js";
import { type DryResult, dryStep, dryWalk, sampleEvent } from "../dry.js";
import {
  ASK_COMMAND,
  ASK_MESSAGE_MAX,
  askPrompt,
  type Edited,
  editRecord,
  undoChange,
} from "../edits.js";
import {
  addExperiment,
  type ExperimentInput,
  experimentRecord,
  removeExperiments,
  shipExperiments,
  startExperiments,
  stopExperiments,
} from "../experiment-store.js";
import { addFlag, type EdgePush, type FlagInput, flagRecord, removeFlags } from "../flag-store.js";
import { roleFits, roleRefusal, spendGrant } from "../grants.js";
import { accountsLacking, blockOf, has, installCheck, withConnected } from "../installs.js";
import {
  addSnippet,
  removeSnippet,
  SNIPPET,
  type SnippetInput,
  snippetRecord,
  snippetsOf,
  snippetTags,
  workflowRecord,
} from "../library.js";
import { doorOf, UNTILS } from "../logic.js";
import {
  accessOf,
  isDemo,
  isOperator,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  type SignedViewer,
  seesInternal,
  teamCan,
  teamSeat,
  whoIs,
} from "../portal.js";
import { refreshRecordAccounts } from "../record-accounts.js";
import { metaOf, type RecordMeta, type RecordType } from "../records.js";
import {
  type ExportAsk,
  type Fence,
  type GetAsk,
  type ListAsk,
  meOf,
  opens,
  type RecordAnswer,
  type RecordsApi,
  type RecordsFile,
  type RecordsPage,
  type RecordsStat,
  type StatsAsk,
  serveRecords,
  toCsv,
} from "../records-serve.js";
import { staleRefusal } from "../refusal.js";
import { finishRun, openRun } from "../runs.js";
import { moveViews, prefsOf, removeView, savedViewsOf, saveView, setPref } from "../saved-views.js";
import { runs, workflowInstalls, workflowSaves } from "../schema.js";
import { factsHeld, type Setup } from "../setup.js";
import { pausedParts } from "../setup-alerts.js";
import {
  clocksOf,
  dropMade,
  editsOf,
  hookEvent,
  lockWorkflowSaves,
  MadeLive,
  type MadeWorkflow,
  madeWorkflows,
  REPLAY_MOST,
  type SpineEvent,
  savedWorkflows,
  workflowHistory,
} from "../spine.js";
import {
  addSurvey,
  answerSurvey,
  pauseSurveys,
  removeSurveys,
  type SurveyInput,
  startSurveys,
  surveyRecord,
  surveysDue,
} from "../survey-store.js";
import { installDefaults } from "../template-defaults.js";
import {
  approveInstall,
  askTemplate,
  declineInstall,
  installOnWorkflow,
  installsOf,
  installTemplate,
  type Plan,
  parseInstallApprovalId,
  readPlan,
  templateNamed,
  templatesNow,
  uninstallTemplate,
} from "../template-install.js";
import { listTokens, makeToken, revokeToken } from "../tokens.js";
import { SANDBOX } from "../view-as.js";
import { patchOf, WORKFLOW_ASK, workflowAskPrompt } from "../workflow-ask.js";
import { deleteWorkflowTemplate, saveWorkflowTemplate } from "../workflow-templates.js";
import {
  effectsIn,
  flowsWith,
  isMade,
  type Made,
  madeBase,
  madeIdOf,
  portsOf,
  type Workflow,
  type WorkflowEdits,
  withEdits,
} from "../workflows.js";
import {
  COMPONENT,
  type ComponentRequest,
  componentRecord,
  type InstallRequest,
} from "./components.js";
import { checkRecord, executionRecordOf, holdRecord, nowAtLabels } from "./executions.js";
import { type HandlerRow, handlerRecord, handlersOf, isPortal } from "./handlers.js";
import {
  type AgentLine,
  eventRecord,
  LOOPS_SQL,
  type LoopRow,
  loopRecord,
  loopsOf,
  type SetLoopRequest,
} from "./loops.js";
import { type RestateAdmin, type RestateAdminGet, runningLoops } from "./restate-admin.js";
import { settingRecord } from "./settings.js";

/** One of the access types (`./access-records.ts`), served to anyone signed in there. */
const isAccess = (id: unknown) => (ACCESS_TYPES as readonly unknown[]).includes(id);

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

/** Lists one `recordsCounts` read totals. */
const COUNTS_MAX = 40;

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
  /** Built-in logic nodes' settings as the draft has them (`WorkflowEdits.settings`). */
  settings?: unknown;
  /** Auto-retry tries, 0 (off) to 5 (`WorkflowEdits.retry`). */
  retry?: unknown;
  reset?: boolean;
  /** A made workflow's new name, kept on its draft. */
  name?: unknown;
  /** The workflow's id, typed: a workflow with a node that sends, posts or spends needs it. */
  confirm?: string;
  /**
   * The newest save the editor read (its draft's or live's id; 0 for none). A save made since
   * refuses this one as changed elsewhere. Absent: no check (the CLI).
   */
  expect?: unknown;
}

/** The editor's base, checked against the newest save under the lock. */
async function checkWorkflowBase(
  tx: Tx,
  client: string | null,
  workflow: string,
  expect: unknown,
): Promise<void> {
  const newest = await lockWorkflowSaves(tx, client, workflow);
  if (expect === undefined || expect === null) return;
  if (typeof expect !== "number" || !Number.isInteger(expect))
    throw new PortalRefusal("expect is a save's number", 400, "expect");
  if (newest !== expect) throw staleRefusal("workflow");
}

/** A door of a workflow's node: its id, for Reveal and Rotate. */
export interface DoorRequest extends PortalRequest {
  workflow?: string;
  id?: unknown;
}

/** A dry test of a draft: from its first input, or one `node` at `port`; a sample or a real event. */
export interface WorkflowTestRequest extends PortalRequest {
  workflow: string;
  wires?: unknown;
  steps?: unknown;
  settings?: unknown;
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
  /** What the test's store heard (`UNTILS`): a Wait until one of them lets go at once. */
  heard?: unknown;
}

/**
 * What a workflow does outside Wren once live: every effect of its parts and logic nodes, nested
 * ones too. Publishing one with any is William's yes (designs/2026-10-06-workflow-editor.md).
 */
export function workflowEffects(
  id: string,
  flows: readonly Workflow[],
  components: readonly Component[],
): string[] {
  return effectsIn(id, flows, components);
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

/** A setting's most characters: a Send webhook's body and headers run long. */
const SETTING_MAX = 2000;

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
            .record(z.string().max(40), z.union([z.string().max(SETTING_MAX), z.number()]))
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
  settings: z
    .record(
      NAME,
      z
        .record(z.string().max(40), z.union([z.string().max(SETTING_MAX), z.number()]))
        .refine((w) => Object.keys(w).length <= 12, "has too many settings"),
    )
    .refine((s) => Object.keys(s).length <= 40, "has too many nodes")
    .optional(),
  /** Auto-retry: a failed step tries again on its own, 0 (off) to 5 times. */
  retry: z.number().int().min(0).max(5).optional(),
});

/** A made workflow's name, as the builder or the name field gives it. */
const MADE_NAME = z.string().trim().min(1).max(60);

/** What the builder is asked, at most. */
const BUILD_MAX = 1000;

/** A stored look stays small: inputs, not tokens. */
const LOOK_MAX = 4000;

/**
 * Wren's loud looks (`SHOWCASE` in @wren/ui's theme.tsx; a test keeps the names the same) and
 * the tokens only they use. A client's portal stays plain: none of these on a client.
 */
export const SHOWCASE_LOOKS: readonly string[] = [
  "aurora",
  "synthwave",
  "terminal",
  "gilded",
  "riso",
  "brutal",
];

export const showcaseIn = (look: unknown): boolean => {
  if (typeof look === "string") return SHOWCASE_LOOKS.includes(look);
  if (!look || typeof look !== "object") return false;
  const l = look as Record<string, unknown>;
  return (
    (typeof l.preset === "string" && SHOWCASE_LOOKS.includes(l.preset)) ||
    "backdrop" in l ||
    "grain" in l
  );
};

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

/** The runs row's command: one line on the run trail, as a CLI command would be. */
export const callCommand = (service: string, handler: string) =>
  `console ${service}/${handler}`.slice(0, 64);

/**
 * The team's record types the console serves: `records` (the worker's `consoleRecords`) and the
 * console's own. Per call it adds the access records and the catalog (`typesFor`).
 */
export function consoleTypes({
  records = [],
  admin,
  adminGet,
  components = [],
  workflows = [],
  edge,
}: {
  records?: readonly RecordType[];
  admin?: RestateAdmin | undefined;
  adminGet?: RestateAdminGet | undefined;
  components?: readonly Component[];
  workflows?: readonly Workflow[];
  edge?: EdgePush | undefined;
}): RecordType[] {
  return [
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
    automationRecord({
      workflows,
      components,
      loops: admin ? async () => loopsOf(await admin(LOOPS_SQL)) : null,
    }),
    eventRecord,
    executionRecordOf(nowAtLabels(workflows, components)),
    holdRecord,
    checkRecord,
  ];
}

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
  /** Ask's context from the asker's notes (`@wren/notes`'s `notesContext`); none without it. */
  askContext?: AskContext | undefined;
}) {
  const allowed = new Set([...views, ...moneyViews]);
  const money = new Set(moneyViews);
  /** The workflows sold as templates: the code's, then the ones saved from a live workflow. */
  const soldNow = () => templatesNow(main, workflows, components);
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
  const types = consoleTypes({ records, admin, adminGet, components, workflows, edge });
  /** The workflow a canvas call names, for Wren or a client it may write, and who's asking. */
  const workflowFor = async (req: WorkflowSaveRequest) => {
    team(req);
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    // No client is Wren's own, as the catalog reads it.
    const client = req.client ? (await pickForWrite(main, req)).client.id : null;
    const w = await workflowOf(req.workflow, client);
    if (!w) throw new PortalRefusal("no such workflow", 404);
    if (client && w.for === "wren") throw new PortalRefusal("that runs Wren's own business", 409);
    return { w, client, by: (req.viewer as SignedViewer).email };
  };
  /**
   * A workflow by id: the code's, else one made in the portal for this owner, as its newest save
   * names it (designs/2026-10-09-workflow-builder.md).
   */
  const workflowOf = async (id: unknown, client: string | null) => {
    if (typeof id !== "string") return undefined;
    const w = workflows.find((x) => x.id === id);
    if (w || !isMade(id)) return w;
    const m = (await madeWorkflows(main, client)).find((x) => x.id === id);
    return m ? madeBase(id, m.made) : undefined;
  };
  /**
   * The run row holding an ask on `w`'s draft, for `Ask/edit` to answer with the next draft. A
   * made workflow with nothing in it is asked to start from a trigger.
   */
  const askGraph = async (
    w: Workflow,
    client: string | null,
    by: string,
    draft: WorkflowEdits,
    message: string,
  ): Promise<string> => {
    const flows = workflows.filter(
      (x) => x.id !== w.id && (w.for === "wren" || x.for === "client"),
    );
    const prompt = workflowAskPrompt({
      w: withEdits(w, draft),
      draft,
      parts: components.filter((c) => !c.planned && (w.for === "wren" || c.for === "client")),
      flows,
      message,
    });
    const argv = { record: WORKFLOW_ASK, id: `${client ?? ""}:${w.id}`, by, message, ...prompt };
    return (await openRun(main, { command: ASK_COMMAND, argv, model: "claude-code:sonnet" })).id;
  };
  /** A made workflow's name on its saves; nothing for the code's. */
  const madeOf = (w: Workflow): { made?: Made } =>
    isMade(w.id) ? { made: { name: w.name, blurb: w.blurb, for: w.for } } : {};
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
      (req.client && req.client !== WREN) || !internal
        ? await withConnected(main, await pickClient(main, req))
        : null;
    // A planned part (`planned: true`, no code runs it) is in no list, palette or map: only its
    // own page, asked for by id (Voice reads its agent's settings that way).
    const byId =
      (req as { record?: unknown; id?: unknown }).record === COMPONENT
        ? (req as { id?: unknown }).id
        : undefined;
    const shown = components.filter(
      (c) => (internal || c.for === "client") && (!c.planned || c.id === byId),
    );
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
    // A made workflow not yet live draws from its name alone; the editor opens its draft.
    const askedId = (req as { id?: unknown }).id;
    if (
      one &&
      typeof askedId === "string" &&
      isMade(askedId) &&
      !flows.some((f) => f.id === askedId)
    ) {
      const m = (await madeWorkflows(main, client?.id ?? null)).find((x) => x.id === askedId);
      if (m) flows.push(madeBase(askedId, m.made));
    }
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
      // Wren's own types that take custom fields carry Wren's live ones.
      ...(await withCustomFields(mine, main)),
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
          list: await soldNow(),
          installs: client ? await installsOf(main, client.id) : [],
          plan:
            internal && client
              ? (db, t) =>
                  onClientDb(client, (cdb) => readPlan(db, cdb, t, client.id, undefined, setups))
              : undefined,
          facts: client ? await factsHeld(main, client.id) : null,
          setups,
          paused: client ? await pausedParts(main, client.id, components) : null,
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
    await refreshRecordAccounts(main);
    return snapshot(main, (tx) => use(serveRecords(all, tx, undefined, fenceOf(req), meOf(req))));
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
  /**
   * A seat change by a teammate below admin (a manager holding `team`): the role given and the
   * one it replaces must both be ones they could hand out, and the clients only ones they see.
   */
  const seatFits = async (
    tx: Queryable,
    req: PortalRequest,
    email: string,
    role: string | undefined,
    list: string[] | null | undefined,
  ) => {
    const by = await whoIs(main, req.viewer);
    if (by && "team" in by && by.team === "admin") return;
    const was = await teamSeat(main, email);
    for (const r of [role ?? (was ? undefined : "operator"), was?.role]) {
      const no = r ? await roleRefusal(tx, by, r, WREN) : null;
      if (no) throw new PortalRefusal(no, 403);
    }
    const mine = by && "team" in by ? by.clients : [];
    const given = list === undefined && !was ? null : list;
    if (
      mine !== null &&
      given !== undefined &&
      (given === null || given.some((c) => !mine.includes(c)))
    )
      throw new PortalRefusal("you can only give clients you see yourself", 403);
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
    // An operator may pick any client, the demo too: its apps come from its components. A social
    // account it connected by signing in (a TikTok) counts toward what a part needs.
    const client = await withConnected(main, await pickClient(main, req));
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
      await finishRun(main, run.id, { error: String(err).slice(0, 5000) });
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
      await finishRun(main, run.id, { error: String(err).slice(0, 5000) });
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
    ...customApi(main, async (id, fn) => {
      const client = await findClient(main, id);
      if (!client) throw new PortalRefusal("no such client", 404);
      if (!mainUrl) throw new PortalRefusal("this worker can't reach the client's database", 503);
      const handle = createDb(clientUrl(mainUrl, client), { max: 1, app: "wren-console" });
      try {
        return await fn(handle.db);
      } finally {
        await handle.close();
      }
    }),
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
    /**
     * Every built part that runs for Wren (its own, or a client part on Wren's settings), in the
     * stages' order.
     */
    agents: async (req: PortalRequest): Promise<AgentLine[]> => {
      team(req);
      const order = Object.keys(STAGES);
      return components
        .filter((c) => !c.planned && (c.for === "wren" || c.wrenSettings))
        .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage))
        .map((c) => ({
          id: c.id,
          name: c.name,
          blurb: c.blurb,
          icon: c.icon,
          stage: c.stage,
          department: STAGES[c.stage],
          ready: c.ready,
          loops: c.provides.loops,
          counts: c.out.flatMap((p) =>
            p.count ? [{ port: p.id, label: p.label, ...p.count }] : [],
          ),
        }));
    },

    /** Decide's numbers per kind (designs/2026-10-16-decide.md): his calls, agreement, spend. */
    decisions: async (req: PortalRequest): Promise<KindStats[]> => {
      team(req);
      return decideStats(main);
    },

    recordsTypes: async (req: PortalRequest): Promise<RecordMeta[]> => {
      const fence = fenceOf(req);
      await refreshRecordAccounts(main);
      return (await typesFor(req)).filter((t) => opens(t, fence(t))).map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk): Promise<RecordsPage> =>
      read(req, (r) => r.list(req)),
    /** Many lists' totals in one read: the sidebar's counts each minute. One it can't read is 0. */
    recordsCounts: async (
      req: PortalRequest & { asks?: unknown },
    ): Promise<{ totals: number[] }> => {
      const asks = (Array.isArray(req.asks) ? req.asks : [])
        .slice(0, COUNTS_MAX)
        .filter((a): a is ListAsk => !!a && typeof (a as ListAsk).record === "string");
      const totals = await Promise.all(
        asks.map((a) => {
          const ask = { ...req, record: a.record, where: a.where, limit: 1 };
          return read(ask, (r) => r.list(ask)).then(
            (p) => p.total,
            () => 0,
          );
        }),
      );
      return { totals };
    },
    recordsGet: (req: PortalRequest & GetAsk): Promise<RecordAnswer> =>
      read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk): Promise<RecordsFile> =>
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
    /** The signed-in person's live AI tool tokens (designs/2026-10-09-ai-tools.md). Never the demo's. */
    tokens: async (req: PortalRequest) => {
      if (isDemo(req.viewer)) return [];
      return listTokens(main, (req.viewer as SignedViewer).email);
    },
    /**
     * A new token, shown once. Pinned to the request's client (a client's own host, or the
     * workspace picked), else to `pin` if given, else as wide as its person.
     */
    tokenMake: async (
      req: PortalRequest & {
        name?: unknown;
        pin?: unknown;
        days?: unknown;
        verbs?: unknown;
        apps?: unknown;
      },
    ) => {
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      if (typeof req.name !== "string") throw new PortalRefusal("name the token", 400);
      const client = req.client || (typeof req.pin === "string" && req.pin ? req.pin : null);
      const days = req.days === undefined || req.days === null ? null : Number(req.days);
      const list = (v: unknown, what: string) => {
        if (v === undefined || v === null) return null;
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string"))
          throw new PortalRefusal(`${what}: a list of names`, 400);
        return v as string[];
      };
      // A token made by a token is held to the maker's cap: it can't widen itself.
      const cap = (req.viewer as SignedViewer).cap;
      const verbs = list(req.verbs, "verbs") ?? (cap ? [...cap.verbs] : null);
      const apps = list(req.apps, "apps") ?? (cap?.apps ? [...cap.apps] : null);
      if (cap && verbs?.some((v) => !cap.verbs.includes(v as Permission)))
        throw new PortalRefusal("This token can't make one that does more.", 403);
      if (cap?.apps && apps?.some((a) => !cap.apps?.includes(a)))
        throw new PortalRefusal("This token can't make one that reaches more.", 403);
      return makeToken(main, (req.viewer as SignedViewer).email, {
        name: req.name,
        client,
        days,
        verbs,
        apps,
      });
    },
    tokenRevoke: async (req: PortalRequest & { id?: unknown }) => {
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      if (typeof req.id !== "string" || !/^[0-9a-f-]{36}$/i.test(req.id))
        throw new PortalRefusal("say which token", 400);
      await revokeToken(main, (req.viewer as SignedViewer).email, req.id);
      return { revoked: req.id };
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
      if (id === SANDBOX) throw new PortalRefusal("that id is View as's sandbox", 400);
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
        await seatFits(tx, req, email, role, list);
        return setTeamSeat(tx, email, {
          ...(role ? { role } : {}),
          ...(list === undefined ? {} : { clients: list }),
        });
      }),
    teamRemove: (req: TeamSeatRequest) =>
      teamWrite(req, async (tx, email) => {
        await seatFits(tx, req, email, undefined, undefined);
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
      if (showcaseIn(look))
        throw new PortalRefusal("showcase looks are Wren's own; a client's stays plain", 400);
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
      const t = templateNamed(await soldNow(), req.template);
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
      const t = templateNamed(await soldNow(), req.template);
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
        await finishRun(main, run.id, { error: String(err).slice(0, 5000) });
        throw err;
      }
    },
    /** Publish: the client's workflow goes to To approve; a person's yes makes it live. */
    async templatePublish(req: TemplateRequest) {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const t = templateNamed(await soldNow(), req.template);
      const client = await pickClient(main, req);
      return askTemplate(main, t, { client: client.id, by: (req.viewer as SignedViewer).email });
    },
    /** Off the client: its loops stop, the door shuts; data, copy and saves stay. */
    async templateUninstall(req: TemplateRequest) {
      team(req);
      const sold = await soldNow();
      const t = templateNamed(sold, req.template);
      const client = await pickClient(main, req);
      const out = await uninstallTemplate(
        main,
        t,
        { client: client.id, by: (req.viewer as SignedViewer).email },
        { workflows, components, templates: sold },
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
      const sold = await soldNow();
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
        const out = await approveInstall(main, id, {
          by,
          workflows,
          components,
          templates: sold,
        });
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
      const sold = await soldNow();
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
          await updateClient(tx, client.id, { accounts: { [site]: account } }, by);
        });
      } catch (err) {
        await finishRun(main, run.id, { error: String(err).slice(0, 5000) });
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
      if (req.reset && isMade(w.id))
        throw new PortalRefusal("a made workflow has no built-in", 400);
      let edits: WorkflowEdits | null = null;
      if (!req.reset) {
        const got = EDITS.safeParse({
          wires: req.wires,
          steps: req.steps,
          settings: req.settings,
          retry: req.retry,
        });
        if (!got.success) {
          const i = got.error.issues[0];
          throw new PortalRefusal(`that doesn't read: ${i?.path.join(".")} ${i?.message}`, 400);
        }
        edits = got.data as WorkflowEdits;
        if (isMade(w.id)) {
          const named = req.name === undefined ? null : MADE_NAME.safeParse(req.name);
          if (named && !named.success) throw new PortalRefusal("give it a name under 60", 400);
          const m = madeOf(w).made as Made;
          edits = { ...edits, made: named ? { ...m, name: named.data } : m };
        }
      }
      const problems = edits
        ? (flowsWith(workflows, { [w.id]: edits }, components).broken[w.id] ?? [])
        : [];
      const id = await atomic(main, async (tx) => {
        await checkWorkflowBase(tx, client, w.id, req.expect);
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
    async workflowPublish(req: WorkflowSaveRequest): Promise<{
      id: number;
      asked?: string;
      doors?: Array<{ node: string; id: string; token: string }>;
      /** Its Schedule nodes' clocks, which the handler starts. */
      start?: LoopKey[];
    }> {
      const { w, client, by } = await workflowFor(req);
      // A client's template: publishing asks in To approve; a person's yes makes it live.
      const row = client ? await installOnWorkflow(main, client, w.id) : null;
      const t = row ? (await soldNow()).find((x) => x.id === row.template) : undefined;
      if (t && client && row) {
        const asked = await askTemplate(main, t, { client, by });
        return { id: 0, asked: asked.id };
      }
      // The draft read under the lock, so a save landing meanwhile is never published stale.
      return atomic(main, async (tx) => {
        await checkWorkflowBase(tx, client, w.id, req.expect);
        const { draft } = await workflowHistory(tx, client, w.id);
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
        // Publishing keeps the switch where it was: an off workflow stays off.
        const wasOff = (await savedWorkflows(tx, client))[w.id]?.edits?.off === true;
        const edits = wasOff && draft.edits ? { ...draft.edits, off: true } : draft.edits;
        const [row] = await tx
          .insert(workflowSaves)
          .values({ client, workflow: w.id, edits, live: true, by })
          .returning({ id: workflowSaves.id });
        await tx.execute(sql`DELETE FROM workflow_saves WHERE NOT live AND workflow = ${w.id}
          AND client IS NOT DISTINCT FROM ${client}`);
        // Each Webhook or Form node's door, made once and kept across publishes.
        const flow = next.flows.find((f) => f.id === w.id) as Workflow;
        const made = await ensureDoors(tx, { client, flow, open: true });
        return { id: row?.id ?? 0, doors: made, start: wasOff ? [] : clocksOf(client, flow) };
      });
    },
    /**
     * A made workflow on or off (designs/2026-10-14-automations.md): a new live save of the same
     * graph with `off` set or cleared. Off, its triggers hear nothing, its doors shut and its
     * clocks stop; subjects already inside finish. On needs what Publish needs, bar the typed id.
     */
    async workflowSwitch(req: WorkflowSaveRequest & { on?: unknown }): Promise<{
      id: number;
      on: boolean;
      start: LoopKey[];
      stop: LoopKey[];
    }> {
      const { w, client, by } = await workflowFor(req);
      if (typeof req.on !== "boolean") throw new PortalRefusal("say on or off", 400);
      const on = req.on;
      if (!isMade(w.id))
        throw new PortalRefusal("a built-in workflow runs by its loops: switch those", 409);
      // Under the lock: a publish landing meanwhile is switched, never reverted to the old graph.
      return atomic(main, async (tx) => {
        await lockWorkflowSaves(tx, client, w.id);
        const live = (await savedWorkflows(tx, client))[w.id];
        if (!live?.edits) throw new PortalRefusal("it isn't live yet: publish it first", 409);
        const next = flowsWith(workflows, { [w.id]: live.edits }, components);
        const flow = next.flows.find((f) => f.id === w.id) as Workflow;
        if (on) {
          const effects = workflowEffects(w.id, next.flows, components);
          if (effects.some((e) => e !== "spends") && !teamCan(req, "effect", WREN))
            throw new PortalRefusal("it sends: only an admin can switch it on", 403);
          if (effects.includes("spends") && !teamCan(req, "money", WREN))
            throw new PortalRefusal("it spends: only an admin can switch it on", 403);
        }
        if ((live.edits.off === true) === !on) return { id: live.id, on, start: [], stop: [] };
        const { off: _, ...rest } = live.edits;
        const edits: WorkflowEdits = on ? rest : { ...rest, off: true };
        const [row] = await tx
          .insert(workflowSaves)
          .values({ client, workflow: w.id, edits, live: true, by })
          .returning({ id: workflowSaves.id });
        const clocks = clocksOf(client, flow);
        return { id: row?.id ?? 0, on, start: on ? clocks : [], stop: on ? [] : clocks };
      });
    },
    /** The doors into a workflow, for its node panel: masked, with their calls. */
    async workflowDoors(req: DoorRequest): Promise<Door[]> {
      team(req);
      const client = req.client ? (await pickClient(main, req)).id : null;
      const w = await workflowOf(req.workflow, client);
      if (!w) throw new PortalRefusal("no such workflow", 404);
      return doorsFor(main, client, w.id);
    },
    /** A door's whole token: a teammate with `manage`, never the demo. */
    async doorReveal(req: DoorRequest): Promise<{ token: string }> {
      const { client } = await workflowFor({ ...req, workflow: String(req.workflow ?? "") });
      return revealDoor(main, req.id, client);
    },
    /** A new token for a door: the old one stops at once. */
    async doorRotate(req: DoorRequest): Promise<{ token: string }> {
      const { client } = await workflowFor({ ...req, workflow: String(req.workflow ?? "") });
      return rotateDoor(main, req.id, client);
    },
    /**
     * The live workflow kept as a template under a name: sold in the Shop and listed in the
     * Library, installed on a client the Shop's way. Saving the name again moves it.
     */
    async workflowTemplateSave(
      req: WorkflowSaveRequest & { name?: unknown; blurb?: unknown },
    ): Promise<{ id: string; name: string; updated: boolean }> {
      const { w, client, by } = await workflowFor(req);
      if (isMade(w.id))
        throw new PortalRefusal("a made workflow can't be a template yet: in development", 409);
      return saveWorkflowTemplate(
        main,
        { client, workflow: w.id, name: req.name, blurb: req.blurb, by },
        { workflows, components },
      );
    },
    /** A saved template deleted: refused while any client runs it live, by how many. */
    async workflowTemplateDelete(
      req: PortalRequest & { template?: unknown },
    ): Promise<{ id: string; name: string }> {
      return deleteWorkflowTemplate(main, { template: req.template, by: teamWriter(req) });
    },
    /** The draft dropped: the live wiring stays as it is. */
    async workflowDiscard(req: WorkflowSaveRequest): Promise<{ done: number }> {
      const { w, client } = await workflowFor(req);
      if (isMade(w.id) && !(await savedWorkflows(main, client))[w.id])
        throw new PortalRefusal("it was never published: delete it instead", 409);
      return atomic(main, async (tx) => {
        await checkWorkflowBase(tx, client, w.id, req.expect);
        const gone = (await tx.execute(sql`DELETE FROM workflow_saves WHERE NOT live
          AND workflow = ${w.id} AND client IS NOT DISTINCT FROM ${client}
          RETURNING id`)) as unknown as unknown[];
        return { done: gone.length };
      });
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
      const got = EDITS.safeParse({
        wires: req.wires ?? [],
        steps: req.steps ?? [],
        settings: req.settings,
      });
      const draft = got.success ? (got.data as WorkflowEdits) : { wires: [], steps: [] };
      return askGraph(w, client, by, draft, message);
    },
    /**
     * The builder (designs/2026-10-09-workflow-builder.md): a new made workflow, its empty draft
     * saved, and, with a message, Claude asked to draw it. Nothing runs until Publish.
     */
    async workflowBuild(
      req: PortalRequest & { message?: unknown; name?: unknown },
    ): Promise<{ workflow: string; ask: string | null }> {
      team(req);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const client = req.client ? (await pickForWrite(main, req)).client.id : null;
      const by = (req.viewer as SignedViewer).email;
      const message = typeof req.message === "string" ? req.message.trim() : "";
      if (message.length > BUILD_MAX)
        throw new PortalRefusal(`keep it under ${BUILD_MAX} characters`, 400);
      const named = MADE_NAME.safeParse(
        typeof req.name === "string" && req.name.trim()
          ? req.name
          : message
            ? message.split(/[.;:,\n]/)[0]?.slice(0, 60)
            : "New workflow",
      );
      if (!named.success) throw new PortalRefusal("give it a name under 60", 400);
      const made: Made = {
        name: named.data,
        blurb: message.slice(0, 200),
        for: client ? "client" : "wren",
      };
      const id = madeIdOf(named.data, randomUUID().slice(0, 4));
      const draft: WorkflowEdits = { wires: [], steps: [], made };
      await main
        .insert(workflowSaves)
        .values({ client, workflow: id, edits: draft, live: false, by });
      const ask = message ? await askGraph(madeBase(id, made), client, by, draft, message) : null;
      return { workflow: id, ask };
    },
    /** The made workflows here, newest first: Wren's, or the client's named. */
    async workflowsMade(req: PortalRequest): Promise<MadeWorkflow[]> {
      team(req);
      const client = req.client ? (await pickClient(main, req)).id : null;
      return madeWorkflows(main, client);
    },
    /** A made workflow deleted: refused while live. */
    async workflowDelete(req: WorkflowSaveRequest): Promise<{ done: number }> {
      const { w, client } = await workflowFor(req);
      if (!isMade(w.id)) throw new PortalRefusal("only a made workflow can be deleted", 409);
      try {
        return await dropMade(main, client, w.id);
      } catch (err) {
        if (err instanceof MadeLive) throw new PortalRefusal(err.message, 409);
        throw err;
      }
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
    async workflowTest(req: WorkflowTestRequest): Promise<DryResult & { entered?: SpineEvent }> {
      team(req);
      const w = await workflowOf(
        req.workflow,
        req.client ? (await pickClient(main, req)).id : null,
      );
      if (!w) throw new PortalRefusal("no such workflow", 404);
      const got = EDITS.safeParse({
        wires: req.wires ?? [],
        steps: req.steps ?? [],
        settings: req.settings,
      });
      if (!got.success) throw new PortalRefusal("that draft doesn't read", 400);
      const { flows, broken } = flowsWith(
        workflows,
        { [w.id]: { ...(got.data as WorkflowEdits), ...madeOf(w) } },
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
      // A door node: the payload enters as the door would take it, its lead read by its map.
      const door = source && !node ? doorOf(source) : null;
      if (door && source) {
        const at = hookEvent(
          { workflow: w.id, input: source.id, subject: door.subject },
          map,
          data,
        );
        if ("error" in at) throw new PortalRefusal(at.error, 400);
        event = { ...at.event, data: { ...at.event.data, lead: leadOf(data, door.fields) } };
      }
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
        heard: Array.isArray(req.heard)
          ? UNTILS.filter((u) => (req.heard as unknown[]).includes(u))
          : [],
      };
      if (node) return dryStep({ ...base, node, port, event });
      const walked = await dryWalk({ ...base, from: from as string, events: [event] });
      // A door's test says what it read, wired on or not.
      return door ? { ...walked, entered: event } : walked;
    },

    eventToRetry(req: PortalRequest & { id?: unknown }): string {
      team(req);
      if (!teamCan(req, "effect", WREN)) throw new PortalRefusal("your role can't run that", 403);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const id = typeof req.id === "string" ? req.id : "";
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new PortalRefusal("no such event", 404);
      return id;
    },

    /** What Replay was given: up to 200 event ids or `workflow/subject` executions. */
    toReplay(req: PortalRequest & { ids?: unknown }): string[] {
      team(req);
      if (!teamCan(req, "effect", WREN)) throw new PortalRefusal("your role can't run that", 403);
      if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
      const ids = Array.isArray(req.ids)
        ? req.ids.filter((x): x is string => typeof x === "string" && x.length <= 300)
        : [];
      if (!ids.length) throw new PortalRefusal("pick what to replay", 400);
      if (ids.length > REPLAY_MOST) throw new PortalRefusal(`at most ${REPLAY_MOST} at once`, 400);
      return ids;
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
      finishRun(main, runId, error === null ? { ok: true } : { error: error.slice(0, 5000) }),

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
