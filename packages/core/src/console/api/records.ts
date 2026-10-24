/**
 * Records and views: a view by name, Wren's record types (list, get, export, stats, counts),
 * edits with undo and Ask, and the viewer's saved views and prefs.
 */
import { type Queryable, serializable, setAuditActor, snapshot } from "@wren/db";
import { and, eq, sql } from "drizzle-orm";
import { can, reach, WREN } from "../../access.js";
import { normalEmail } from "../../clients/index.js";
import {
  ASK_COMMAND,
  ASK_MESSAGE_MAX,
  askPrompt,
  type Edited,
  editRecord,
  undoChange,
} from "../../edits.js";
import { spendGrant } from "../../grants.js";
import {
  accessOf,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  type SignedViewer,
  seesInternal,
  teamCan,
  whoIs,
} from "../../portal.js";
import { refreshRecordAccounts } from "../../record-accounts.js";
import { metaOf, type RecordMeta, type RecordType } from "../../records.js";
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
} from "../../records-serve.js";
import { openRun } from "../../runs.js";
import {
  moveViews,
  prefsOf,
  removeView,
  savedViewsOf,
  saveView,
  setPref,
} from "../../saved-views.js";
import { runs } from "../../schema.js";
import { COMPONENT } from "../components.js";
import { type ConsoleContext, isAccess } from "./context.js";
import type {
  AskRequest,
  Cell,
  EditRequest,
  KeepRequest,
  UndoRequest,
  ViewAnswer,
  ViewRequest,
} from "./requests.js";

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

export function recordsHandlers(ctx: ConsoleContext) {
  const { main, allowed, money, team, rowAt, verbAt, typesFor } = ctx;
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
  return {
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
  };
}
