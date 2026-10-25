/**
 * `consoleContext`: what every ConsolePortal handler group closes over, built once per
 * `consoleApi` call (`../console-api.ts`), with `ConsoleDeps` (what the worker passes in) and
 * `consoleTypes` (the record types the console serves).
 */
import { createDb, type Db, type Queryable } from "@wren/db";
import { type Permission, type Target, WREN } from "../../access.js";
import { ACCESS_TYPES, accessRecords } from "../../access-records.js";
import type { AskContext } from "../../ask.js";
import { automationRecord } from "../../automations.js";
import { type Client, changeRecord, clientUrl, teamRecord } from "../../clients/index.js";
import type { Component } from "../../components.js";
import { withCustomFields } from "../../custom-fields.js";
import { editsOf, madeWorkflows, savedWorkflows, workflowHistory } from "../../executor.js";
import { experimentRecord } from "../../experiment-store.js";
import { type EdgePush, flagRecord } from "../../flag-store.js";
import { withConnected } from "../../installs.js";
import { SNIPPET, snippetRecord, snippetTags, workflowRecord } from "../../library.js";
import {
  accessOf,
  isDemo,
  isOperator,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  type SignedViewer,
  seesInternal,
  teamCan,
  whoIs,
} from "../../portal.js";
import type { RecordType } from "../../records.js";
import { serveRecords } from "../../records-serve.js";
import { factsHeld, type Setup } from "../../setup.js";
import { pausedParts } from "../../setup-alerts.js";
import { surveyRecord } from "../../survey-store.js";
import { installsOf, readPlan, templatesNow } from "../../template-install.js";
import { flowsWith, isMade, madeBase, type Workflow } from "../../workflows.js";
import { COMPONENT, componentRecord } from "../components.js";
import { checkRecord, executionRecordOf, holdRecord, nowAtLabels } from "../executions.js";
import { handlerRecord } from "../handlers.js";
import { eventRecord, LOOPS_SQL, loopRecord, loopsOf } from "../loops.js";
import { type RestateAdmin, type RestateAdminGet, runningLoops } from "../restate-admin.js";
import { settingRecord } from "../settings.js";

/** One of the access types (`./access-records.ts`), served to anyone signed in there. */
export const isAccess = (id: unknown) => (ACCESS_TYPES as readonly unknown[]).includes(id);

/** What the worker hands `consoleApi` (`makeConsolePortal`, `../console-portal.ts`). */
export interface ConsoleDeps {
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
}

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

/**
 * The context one `consoleApi` call builds once and every handler group takes: the deps the
 * handlers read, the sets built from them and the closures more than one group shares (who may
 * act, where a row is, the types this login sees). A helper one group alone uses lives in that
 * group's file.
 */
export function consoleContext({
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
}: ConsoleDeps) {
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
    // The client's own wiring, as the executor runs it: only one catalog item draws a workflow.
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
  /** Restate's admin for Wren's team; refused before any read, so a refusal never lands in a journaled step. */
  const adminFor = (req: PortalRequest): RestateAdmin => {
    team(req);
    if (!admin) throw new PortalRefusal("this worker has no Restate admin URL", 503);
    return admin;
  };
  return {
    main,
    mainUrl,
    admin,
    adminGet,
    components,
    workflows,
    asked,
    bound,
    edge,
    setups,
    allowed,
    money,
    soldNow,
    onClientDb,
    team,
    teamWriter,
    rowAt,
    verbAt,
    typesFor,
    adminFor,
  };
}

export type ConsoleContext = ReturnType<typeof consoleContext>;
