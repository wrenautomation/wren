/**
 * PipelineConsole: a workspace's pipeline records and the hand moves on them
 * (designs/2026-10-19-business-map.md). The workspace is Wren's for Wren's team naming no client,
 * else the client named: each reads and writes its own database.
 *
 * - `records*`: offers, the shape, journeys, deals and numbers.
 * - `offersSync`: add a version for each registry offer that changed (Wren's workspace only).
 * - `shapeVersion`, `shapeDiff`, `shapeImport`: save the next shape version, compare two, or read
 *   a shape file (YAML) into the next version.
 * - `shapeStart`, `shapeExport`, `shapePreview`: the Map's own: start an empty workspace from the
 *   starter, write a body as a file, and compare a file with the newest version before it saves.
 * - `shapeDraftNew|Update|Edit|Propose|Apply|Drop`, `shapeDraftPlan`, `shapeBlame`, `shapeUndoPreview`, `shapeUndo`, `shapeAttach`,
 *   `shapeTag`: the shape's history like git (`history.ts` has what each takes and answers). A
 *   save of the shape is followed by the mirror step: the version lands as a commit in the
 *   private repo, and a failed mirror never fails the save.
 * - `journeysOpen`, `journeysMove`, `journeysDrop`, `journeysAssign`: the `Journeys` service, as the
 *   operator.
 * - `dealsSign`: a deal's terms, once; a change needs `force` and is audited.
 * - `termsAdd`: the next version of one plan of one offer, as `wren terms add` (same checks).
 *
 * Every write goes through the store or the `Journeys` service, never a second path.
 */
import type * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import type { Client } from "@wren/core/clients";
import { withCustomFields } from "@wren/core/custom-fields";
import type { GithubFiles } from "@wren/core/github";
import { TRIGGER_IDS } from "@wren/core/logic";
import {
  answer,
  canAt,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { metaOf, type RecordType } from "@wren/core/records";
import {
  type ExportAsk,
  fenceFor,
  type GetAsk,
  type ListAsk,
  meOf,
  opens,
  type RecordsApi,
  type StatsAsk,
  serveRecords,
} from "@wren/core/records/serve";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { type Db, type Queryable, snapshot } from "@wren/db";
import { OFFER_IDS, OFFERS, type Terms } from "@wren/offers";
import { z } from "zod";
import { attachShape } from "./attach.js";
import { PIPELINE_CONSOLE_APPS, PIPELINE_CONSOLE_ROUTES } from "./console-routes.js";
import {
  applyDraft,
  bodyOfRef,
  dropDraft,
  editDraft,
  newDraft,
  parseRef,
  planApply,
  proposeDraft,
  updateDraft,
} from "./drafts.js";
import type {
  AttachAnswer,
  AttachAsk,
  BlameAnswer,
  BlameAsk,
  DiffAnswer,
  DiffAsk,
  DraftApplyAnswer,
  DraftDropAsk,
  DraftEditAnswer,
  DraftEditAsk,
  DraftIdAsk,
  DraftNewAnswer,
  DraftNewAsk,
  DraftPlanAnswer,
  DraftStateAnswer,
  DraftUpdateAnswer,
  DraftUpdateAsk,
  PreviewAnswer,
  ShapeRef,
  TagAnswer,
  TagAsk,
  UndoAnswer,
  UndoAsk,
  UndoPreviewAnswer,
} from "./history.js";
import { ATTACH_KINDS, isMetro } from "./metro.js";
import { MetroOpSchema } from "./metro-ops.js";
import { type MirrorResult, mirrorShapes, WREN_WORKSPACE } from "./mirror.js";
import type { ShapeBody } from "./model.js";
import { signDeal } from "./moves.js";
import { PIPELINE_RECORDS } from "./records.js";
import { JOURNEYS, type OpenRequest as JourneyOpen, type JourneysApi } from "./restate.js";
import { exportShape, importShape, parseShape } from "./shape-file.js";
import { startShape } from "./starter.js";
import { addTerms, newestShape, Refused, saveShape, shapeVersionsOf, syncOffers } from "./store.js";
import {
  type BlameOn,
  diffAnswerOf,
  historyOfStored,
  metroView,
  type StoredBody,
} from "./stored.js";
import { addTag } from "./tags.js";
import { planUndo, undoShape } from "./undo.js";

export interface PipelineConsoleDeps {
  /** Main: the client registry, and Wren's own workspace. */
  db: Db;
  /** A client's database. */
  open: (client: Pick<Client, "id" | "database">) => Db;
  /** Left out: `PIPELINE_RECORDS`. */
  records?: readonly RecordType[];
  /** The private repo the shape mirror commits to, with its name; null or left out: the mirror is off. */
  shapes?: { files: GithubFiles; repo: string } | null;
}

export interface ShapeVersionRequest extends PortalRequest {
  /** Why it changed. */
  note: string;
  /** A body to save, or `from`. The CLI and agents send a body; the web never does. */
  body?: unknown;
  /** A restore: save the stored body of this version as the next one. */
  from?: number;

  /** Where journeys on a node the body drops go: `{ oldNode: newNode }`. */
  moves?: Record<string, string>;
}
export type ShapeDiffRequest = PortalRequest & DiffAsk;
export type DraftNewRequest = PortalRequest & DraftNewAsk;
export type DraftUpdateRequest = PortalRequest & DraftUpdateAsk;
export type DraftEditRequest = PortalRequest & DraftEditAsk;
export type DraftIdRequest = PortalRequest & DraftIdAsk;
export type DraftDropRequest = PortalRequest & DraftDropAsk;
export type BlameRequest = PortalRequest & BlameAsk;
export type UndoRequest = PortalRequest & UndoAsk;
export type TagRequest = PortalRequest & TagAsk;
export type AttachRequest = PortalRequest & AttachAsk;
export interface ShapeImportRequest extends PortalRequest {
  /** The shape file's YAML text. */
  text: string;
  /** The version's note when the file has none. */
  note?: string;
}
export interface ShapeExportRequest extends PortalRequest {
  /** The version or `draft:<id>` to write as a file; the newest version when left out. */
  ref?: ShapeRef;
}
export interface ShapePreviewRequest extends PortalRequest {
  /** The shape file's YAML text. */
  text: string;
}
export interface JourneyOpenRequest extends PortalRequest {
  person: string;
  /** A node to open at; the one the source's edge leads to when left out. */
  at?: string;
  /** A source node id. */
  entry?: string;
}
export interface JourneyMoveRequest extends PortalRequest {
  journey: string;
  /** A node id. */
  to: string;
  /** Needed when no edge path leads there. */
  reason?: string;
}
export interface JourneyDropRequest extends PortalRequest {
  journey: string;
  reason: string;
}
export interface JourneyAssignRequest extends PortalRequest {
  journey: string;
  /** A team member's email; left out or null clears the owner. */
  to?: string | null;
}
export interface DealSignRequest extends PortalRequest {
  deal: string;
  plan: string;
  force?: boolean;
}
export interface TermsAddRequest extends PortalRequest {
  offer: string;
  plan: string;
  /** The first day it applies: YYYY-MM-DD. */
  from: string;
  body: unknown;
  why: string;
}

/** What a blame can ask about: the graph's node and edge, and the map model's own kinds. */
const BLAME_ONS = [
  "node",
  "edge",
  "station",
  "track",
  "line",
  "group",
] as const satisfies readonly BlameOn[];

const noShape = (): never => {
  throw new Refused(["This workspace has no shape yet."]);
};

/**
 * The body to save for a restore of version `n`, as a metro body: an old graph version is saved
 * as its drawn form, as the store refuses a graph body. Refused when there is no such version.
 */
const restoreBody = async (db: Db, n: unknown): Promise<StoredBody> => {
  const version = Number(n);
  if (!Number.isInteger(version) || version < 1)
    throw new Refused([`"${String(n)}" is not a version number.`]);
  return metroView(await bodyOfRef(db, version));
};

/** A store refusal as the portal's: its reasons in one message, status 400. */
const refused = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Refused) throw new PortalRefusal(e.errors.join(" "), 400);
    throw e;
  }
};

/** The handlers as plain calls: the service wraps them, tests call them. */
export function pipelineConsoleApi({
  db,
  open,
  records = PIPELINE_RECORDS,
  shapes = null,
}: PipelineConsoleDeps) {
  /**
   * Whose pipeline: the client named, else Wren's for Wren's team, else the login's own client.
   * Refused past what the viewer may `p` in Opportunities there; a change never on the demo.
   */
  const workspace = async (
    req: PortalRequest,
    p: "read" | "act",
  ): Promise<{ client: string | null; db: Db }> => {
    const v = req.viewer;
    const named = req.client && req.client !== WREN ? req.client : null;
    if (p === "act" && isDemo(v)) throw new PortalRefusal("the demo is read-only", 403);
    const wren = !named && !isDemo(v) && v.operator === true;
    const client = wren
      ? null
      : p === "act"
        ? (await pickForWrite(db, req)).client
        : await pickClient(db, req);
    if (!(await canAt(db, req, p, { client: client?.id ?? WREN, app: "deals", channel: null })))
      throw new PortalRefusal(p === "read" ? "no access" : "your role can't do that here", 403);
    return client ? { client: client.id, db: open(client) } : { client: null, db };
  };
  /** The operator's name on a change; the demo changes nothing. */
  const by = (req: PortalRequest) => {
    const email = (req.viewer as SignedViewer).email;
    if (isDemo(req.viewer) || !email) throw new PortalRefusal("sign in to change journeys", 403);
    return email;
  };
  /**
   * The types as this workspace shows them: a type that takes custom fields gets the workspace's
   * own, read from the database that holds the rows (main for Wren, a client's own for it). In
   * either, the workspace's fields keep owner null. Their values are set by the Set field step;
   * no form edits them here, so `edits` goes.
   */
  const typesFor = async (db: Queryable): Promise<RecordType[]> => {
    return (await withCustomFields(records, db)).map((t) => {
      if (!t.custom) return t;
      const { edits: _edits, ...rest } = t;
      return rest;
    });
  };
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const w = await workspace(req, "read");
    return snapshot(w.db, async (tx) =>
      use(
        serveRecords(await typesFor(tx), tx, undefined, fenceFor(req, w.client ?? WREN), meOf(req)),
      ),
    );
  };
  /** A metro body, or a graph body, which the store then refuses (`CONVERT_FIRST`). */
  const bodyOf = (v: unknown): StoredBody => {
    if (isMetro(v)) return v;
    const nodes = (v as { nodes?: unknown } | null)?.nodes;
    if (!v || typeof v !== "object" || !Array.isArray(nodes))
      throw new PortalRefusal("the body needs nodes", 400);
    return v as ShapeBody;
  };

  return {
    workspace,
    by,
    recordsTypes: async (req: PortalRequest) => {
      const w = await workspace(req, "read");
      const fence = fenceFor(req, w.client ?? WREN);
      return (await typesFor(w.db))
        .filter((t) => !fence || opens(t, fence(t)))
        .map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),

    offersSync: async (req: PortalRequest) => {
      const w = await workspace(req, "act");
      if (w.client) throw new PortalRefusal("offers sync in Wren's workspace only", 400);
      return refused(() => syncOffers(w.db, OFFERS, by(req)));
    },
    shapeVersion: async (req: ShapeVersionRequest) => {
      const w = await workspace(req, "act");
      // Exactly one of `body` and `from`. A restore reads the stored body of an older version.
      if ((req.body != null) === (req.from != null))
        throw new PortalRefusal("Send exactly one of body or from.", 400);
      const row = await refused(async () =>
        saveShape(w.db, {
          body: req.from != null ? await restoreBody(w.db, req.from) : bodyOf(req.body),
          note: String(req.note ?? ""),
          by: by(req),
          triggers: TRIGGER_IDS,
          ...(req.moves ? { moves: req.moves } : {}),
        }),
      );
      return { version: row.number };
    },
    shapeDiff: async (req: ShapeDiffRequest): Promise<DiffAnswer> => {
      const w = await workspace(req, "read");
      // A version number or `draft:<id>`. The answer carries the lines and both sides drawn, so
      // the web never needs a body.
      return refused(async () => {
        const a = parseRef(req.a);
        const b = parseRef(req.b);
        const newest = await newestShape(w.db);
        const [from, to] = [await bodyOfRef(w.db, a), await bodyOfRef(w.db, b)];
        return { a, b, ...diffAnswerOf(from, to, newest ? isMetro(newest.body) : false) };
      });
    },
    shapeImport: async (req: ShapeImportRequest) => {
      const w = await workspace(req, "act");
      const done = await refused(() =>
        importShape(w.db, String(req.text ?? ""), {
          by: by(req),
          triggers: TRIGGER_IDS,
          ...(req.note ? { note: req.note } : {}),
        }),
      );
      return {
        version: done.shape?.number ?? (await newestShape(w.db))?.number ?? null,
        changed: done.shape !== null,
        terms: done.terms.map((t) => ({ offer: t.offer, plan: t.plan, version: t.number })),
      };
    },
    shapeStart: async (req: PortalRequest) => {
      const w = await workspace(req, "act");
      const row = await refused(() => startShape(w.db, { by: by(req), triggers: TRIGGER_IDS }));
      if (!row) throw new PortalRefusal("This workspace already has a shape.", 400);
      return { version: row.number };
    },
    shapeExport: async (req: ShapeExportRequest) => {
      const w = await workspace(req, "read");
      return refused(async () => {
        const ref =
          req.ref != null ? parseRef(req.ref) : ((await newestShape(w.db))?.number ?? noShape());
        return { text: exportShape(await bodyOfRef(w.db, ref)) };
      });
    },
    shapePreview: async (req: ShapePreviewRequest): Promise<PreviewAnswer> => {
      const w = await workspace(req, "read");
      const file = await refused(async () => parseShape(String(req.text ?? "")));
      const newest = await newestShape(w.db);
      const none: ShapeBody = { name: file.body.name, nodes: [], edges: [] };
      // Compared as an import would save it: the file against the newest version.
      const parts = await refused(async () => diffAnswerOf(newest ? newest.body : none, file.body));
      return {
        a: newest?.number ?? null,
        ...parts,
        note: file.note ?? null,
        moves: file.moves ?? null,
      };
    },
    shapeDraftNew: async (req: DraftNewRequest): Promise<DraftNewAnswer> => {
      const w = await workspace(req, "act");
      const who = by(req);
      const row = await refused(() =>
        newDraft(w.db, {
          name: String(req.name ?? ""),
          ...(req.body != null ? { body: bodyOf(req.body) } : {}),
          ...(req.moves ? { moves: req.moves } : {}),
          ...(req.base != null ? { base: Number(req.base) } : {}),
          ...(req.note ? { note: req.note } : {}),
          by: who,
        }),
      );
      return { id: row.id, base: row.base };
    },
    shapeDraftUpdate: async (req: DraftUpdateRequest): Promise<DraftUpdateAnswer> => {
      const w = await workspace(req, "act");
      const row = await refused(() =>
        updateDraft(w.db, {
          id: String(req.id ?? ""),
          by: by(req),
          body: bodyOf(req.body),
          ...(req.moves ? { moves: req.moves } : {}),
          ...(req.note != null ? { note: req.note } : {}),
        }),
      );
      return { id: row.id, updatedAt: row.updatedAt.toISOString() };
    },
    shapeDraftEdit: async (req: DraftEditRequest): Promise<DraftEditAnswer> => {
      const w = await workspace(req, "act");
      const done = await refused(() =>
        editDraft(w.db, {
          id: String(req.id ?? ""),
          ops: req.ops,
          by: by(req),
          triggers: TRIGGER_IDS,
        }),
      );
      return { id: done.draft.id, lines: done.lines, warnings: done.warnings };
    },
    shapeDraftPlan: async (req: DraftIdRequest): Promise<DraftPlanAnswer> => {
      const w = await workspace(req, "read");
      const plan = await refused(() => planApply(w.db, String(req.id ?? "")));
      return {
        id: plan.draft.id,
        base: plan.base,
        live: plan.live,
        moved: plan.moved,
        conflicts: plan.conflictLines,
        lines: plan.lines,
      };
    },
    shapeDraftPropose: async (req: DraftIdRequest): Promise<DraftStateAnswer> => {
      const w = await workspace(req, "act");
      const who = by(req);
      const row = await refused(() => proposeDraft(w.db, { id: String(req.id ?? ""), by: who }));
      return { id: row.id, state: row.state };
    },
    shapeDraftApply: async (req: DraftIdRequest): Promise<DraftApplyAnswer> => {
      const w = await workspace(req, "act");
      const done = await refused(() =>
        applyDraft(w.db, { id: String(req.id ?? ""), by: by(req), triggers: TRIGGER_IDS }),
      );
      return { id: done.draft.id, version: done.version.number };
    },
    shapeDraftDrop: async (req: DraftDropRequest): Promise<DraftStateAnswer> => {
      const w = await workspace(req, "act");
      const who = by(req);
      const row = await refused(() =>
        dropDraft(w.db, { id: String(req.id ?? ""), reason: String(req.reason ?? ""), by: who }),
      );
      return { id: row.id, state: row.state };
    },
    shapeBlame: async (req: BlameRequest): Promise<BlameAnswer> => {
      const w = await workspace(req, "read");
      const named = BLAME_ONS.filter((on) => req[on]);
      const on = named[0];
      if (named.length !== 1 || !on)
        throw new PortalRefusal(`Name exactly one of ${BLAME_ONS.join(", ")}.`, 400);
      return {
        lines: historyOfStored(await shapeVersionsOf(w.db), String(req[on]), on),
      };
    },
    shapeUndoPreview: async (req: UndoRequest): Promise<UndoPreviewAnswer> => {
      const w = await workspace(req, "read");
      const plan = await refused(() =>
        planUndo(w.db, {
          a: Number(req.a),
          b: Number(req.b),
          change: String(req.change ?? ""),
          triggers: TRIGGER_IDS,
        }),
      );
      return {
        line: plan.line,
        note: plan.note,
        newest: plan.newest.number,
        ...diffAnswerOf(plan.newest.body, plan.result),
      };
    },
    shapeUndo: async (req: UndoRequest): Promise<UndoAnswer> => {
      const w = await workspace(req, "act");
      const row = await refused(() =>
        undoShape(w.db, {
          a: Number(req.a),
          b: Number(req.b),
          change: String(req.change ?? ""),
          by: by(req),
          triggers: TRIGGER_IDS,
        }),
      );
      return { version: row.number };
    },
    shapeAttach: async (req: AttachRequest): Promise<AttachAnswer> => {
      const w = await workspace(req, "act");
      const row = await refused(() =>
        attachShape(w.db, {
          on: req.on,
          id: String(req.id ?? ""),
          add: req.add ?? undefined,
          remove: req.remove ?? undefined,
          by: by(req),
          triggers: TRIGGER_IDS,
        }),
      );
      return { version: row.number };
    },
    shapeTag: async (req: TagRequest): Promise<TagAnswer> => {
      const w = await workspace(req, "act");
      const row = await refused(() =>
        addTag(w.db, {
          name: String(req.name ?? ""),
          version: Number(req.version),
          ...(req.note ? { note: req.note } : {}),
          by: by(req),
        }),
      );
      return { name: row.name, version: row.version };
    },
    /**
     * The mirror step after a save: commit the versions the private repo lacks. A failed mirror
     * is told in the answer and the log, never thrown: the save stands, the next run catches up.
     */
    mirror: async (req: PortalRequest): Promise<MirrorResult> => {
      try {
        const w = await workspace(req, "read");
        return await mirrorShapes(w.db, {
          files: shapes?.files ?? null,
          repo: shapes?.repo ?? "",
          workspace: w.client ?? WREN_WORKSPACE,
        });
      } catch (e) {
        return { committed: [], failed: e instanceof Error ? e.message : String(e) };
      }
    },
    termsAdd: async (req: TermsAddRequest) => {
      const w = await workspace(req, "act");
      if (w.client) throw new PortalRefusal("terms are added in Wren's workspace only", 400);
      const who = by(req);
      const offer = String(req.offer ?? "");
      if (!OFFER_IDS.has(offer))
        throw new PortalRefusal(`"${offer}" is not in the offer registry.`, 400);
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
        throw new PortalRefusal("The terms must be a JSON object.", 400);
      const row = await refused(() =>
        addTerms(w.db, {
          offer,
          plan: String(req.plan ?? ""),
          from: String(req.from ?? ""),
          body: req.body as Terms,
          why: String(req.why ?? ""),
          by: who,
        }),
      );
      return { offer: row.offer, plan: row.plan, version: row.number, from: row.effectiveFrom };
    },
    dealsSign: async (req: DealSignRequest) => {
      const w = await workspace(req, "act");
      by(req);
      return refused(() =>
        signDeal(w.db, { deal: req.deal, plan: req.plan, force: req.force === true }),
      );
    },
  };
}

/**
 * A save of the shape, then the mirror step: the version lands as a commit in the private repo.
 * Each is one journal entry, so a retry never saves twice. `api.mirror` never throws, so a failed
 * mirror leaves the save standing; the next mirror run commits what is missing.
 */
export async function saveThenMirror<Q extends PortalRequest, T>(
  ctx: Pick<restate.Context, "run">,
  api: { mirror: (req: PortalRequest) => Promise<unknown> },
  name: string,
  req: Q,
  save: (req: Q) => Promise<T>,
): Promise<T> {
  return answer(async () => {
    const saved = await ctx.run(name, () => answer(() => save(req)));
    await ctx.run("shape mirror", () => api.mirror(req));
    return saved;
  });
}

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };
const bodySchema = z.looseObject({}).describe("The shape body: name, nodes, edges");
const movesSchema = z
  .record(z.string(), z.string())
  .nullish()
  .describe("Where journeys on a dropped node go: { oldNode: newNode }");
const refSchema = z.union([z.number(), z.string()]);
const undoFields = {
  a: z.number().describe("The diff's first shape version"),
  b: z.number().describe("The diff's second shape version"),
  change: z
    .string()
    .describe("A change key from the diff, like node:<id>:added or station:<id>:added"),
};
const draftId = z.string().describe("The draft's id, from the draft list");

export function makePipelineConsole(deps: PipelineConsoleDeps) {
  const api = pipelineConsoleApi(deps);
  const journeys = (ctx: restate.Context) => ctx.serviceClient<JourneysApi>(JOURNEYS);
  return portalService({
    name: "PipelineConsole",
    main: deps.db,
    routes: PIPELINE_CONSOLE_ROUTES,
    apps: PIPELINE_CONSOLE_APPS,
    unnamed: "wren",
    handlers: {
      recordsTypes: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest) =>
        answer(() => api.recordsTypes(req)),
      ),
      recordsList: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & ListAsk) =>
        answer(() => api.recordsList(req)),
      ),
      recordsGet: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & GetAsk) =>
        answer(() => api.recordsGet(req)),
      ),
      recordsExport: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & ExportAsk) =>
        answer(() => api.recordsExport(req)),
      ),
      recordsStats: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest & StatsAsk) =>
        answer(() => api.recordsStats(req)),
      ),
      offersSync: serviceHandler(RECORDS, (ctx: restate.Context, req: PortalRequest) =>
        answer(() => ctx.run("offers sync", () => answer(() => api.offersSync(req)))),
      ),
      shapeVersion: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            note: z.string().describe("Why, in a sentence"),
            body: bodySchema
              .nullish()
              .describe("The shape body: name, nodes, edges. Give this or from, not both"),
            from: z
              .number()
              .nullish()
              .describe("A shape version to save again as the next one. Give this or body"),
            moves: z
              .record(z.string(), z.string())
              .nullish()
              .describe("Where journeys on a dropped node go: { oldNode: newNode }"),
          }),
        },
        (ctx: restate.Context, req: ShapeVersionRequest) =>
          saveThenMirror(ctx, api, "shape version", req, api.shapeVersion),
      ),
      shapeDiff: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            a: refSchema.describe("A shape version number, or draft:<id>"),
            b: refSchema.describe("Another shape version number, or draft:<id>"),
          }),
        },
        (_: restate.Context, req: ShapeDiffRequest) => answer(() => api.shapeDiff(req)),
      ),
      shapeImport: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            text: z.string().describe("The shape file, as YAML"),
            note: z.string().nullish().describe("The version's note when the file has none"),
          }),
        },
        (ctx: restate.Context, req: ShapeImportRequest) =>
          saveThenMirror(ctx, api, "shape import", req, api.shapeImport),
      ),
      shapeStart: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS }) },
        (ctx: restate.Context, req: PortalRequest) =>
          saveThenMirror(ctx, api, "shape start", req, api.shapeStart),
      ),
      shapeExport: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ref: refSchema
              .nullish()
              .describe("A shape version number, or draft:<id>. The newest version when left out"),
          }),
        },
        (_: restate.Context, req: ShapeExportRequest) => answer(() => api.shapeExport(req)),
      ),
      shapePreview: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            text: z.string().describe("The shape file, as YAML"),
          }),
        },
        (_: restate.Context, req: ShapePreviewRequest) => answer(() => api.shapePreview(req)),
      ),
      shapeDraftNew: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            name: z.string().describe("The draft's name: a few words"),
            body: bodySchema
              .nullish()
              .describe("A graph body. Left out: the draft forks the base version as it is"),
            moves: movesSchema,
            base: z
              .number()
              .nullish()
              .describe("The shape version it forks. The newest when left out"),
            note: z.string().nullish().describe("Why, in a sentence"),
          }),
        },
        (ctx: restate.Context, req: DraftNewRequest) =>
          answer(() => ctx.run("shape draft new", () => answer(() => api.shapeDraftNew(req)))),
      ),
      shapeDraftUpdate: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            id: draftId,
            body: bodySchema,
            moves: movesSchema,
            note: z.string().nullish().describe("Why. Left out keeps the note"),
          }),
        },
        (ctx: restate.Context, req: DraftUpdateRequest) =>
          answer(() =>
            ctx.run("shape draft update", () => answer(() => api.shapeDraftUpdate(req))),
          ),
      ),
      shapeDraftEdit: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            id: draftId,
            ops: z
              .union([MetroOpSchema, z.array(MetroOpSchema).min(1)])
              .describe("One edit, or a list of edits, made in order. All or nothing"),
          }),
        },
        (ctx: restate.Context, req: DraftEditRequest) =>
          answer(() => ctx.run("shape draft edit", () => answer(() => api.shapeDraftEdit(req)))),
      ),
      shapeDraftPlan: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, id: draftId }) },
        (_: restate.Context, req: DraftIdRequest) => answer(() => api.shapeDraftPlan(req)),
      ),
      shapeDraftPropose: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, id: draftId }) },
        (ctx: restate.Context, req: DraftIdRequest) =>
          answer(() =>
            ctx.run("shape draft propose", () => answer(() => api.shapeDraftPropose(req))),
          ),
      ),
      shapeDraftApply: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, id: draftId }) },
        (ctx: restate.Context, req: DraftIdRequest) =>
          saveThenMirror(ctx, api, "shape draft apply", req, api.shapeDraftApply),
      ),
      shapeDraftDrop: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            id: draftId,
            reason: z.string().describe("Why it is dropped"),
          }),
        },
        (ctx: restate.Context, req: DraftDropRequest) =>
          answer(() => ctx.run("shape draft drop", () => answer(() => api.shapeDraftDrop(req)))),
      ),
      shapeBlame: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            node: z.string().nullish().describe("A graph node id. Give one of the six, not more"),
            edge: z.string().nullish().describe("A graph edge id"),
            station: z.string().nullish().describe("A station id"),
            track: z.string().nullish().describe("A track id"),
            line: z.string().nullish().describe("A line id"),
            group: z.string().nullish().describe("A group id"),
          }),
        },
        (_: restate.Context, req: BlameRequest) => answer(() => api.shapeBlame(req)),
      ),
      shapeUndoPreview: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ...undoFields }) },
        (_: restate.Context, req: UndoRequest) => answer(() => api.shapeUndoPreview(req)),
      ),
      shapeUndo: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ...undoFields }) },
        (ctx: restate.Context, req: UndoRequest) =>
          saveThenMirror(ctx, api, "shape undo", req, api.shapeUndo),
      ),
      shapeAttach: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            on: z
              .enum(["line", "station", "group"])
              .describe("The part that holds the attach list"),
            id: z.string().describe("The line, station or group id"),
            add: z
              .object({
                kind: z.enum(ATTACH_KINDS),
                ref: z.string().describe("An id or an https URL"),
                label: z.string().nullish(),
              })
              .nullish()
              .describe("The attach to add. Give this or remove"),
            remove: z.string().nullish().describe("The ref to remove. Give this or add"),
          }),
        },
        (ctx: restate.Context, req: AttachRequest) =>
          saveThenMirror(ctx, api, "shape attach", req, api.shapeAttach),
      ),
      shapeTag: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            name: z.string().describe("The tag: a release name, 1 to 60 characters"),
            version: z.number().describe("The shape version it labels"),
            note: z.string().nullish().describe("Why, in a sentence"),
          }),
        },
        (ctx: restate.Context, req: TagRequest) =>
          answer(() => ctx.run("shape tag", () => answer(() => api.shapeTag(req)))),
      ),
      journeysOpen: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            person: z.string().describe("A profile id, an email, a phone (+...) or kind:value"),
            at: z.string().nullish().describe("A node to open at; the source's own when left out"),
            entry: z.string().nullish().describe("A source node id"),
          }),
        },
        (ctx: restate.Context, req: JourneyOpenRequest) =>
          answer(async () => {
            const w = await api.workspace(req, "act");
            const ask: JourneyOpen = {
              client: w.client,
              person: req.person,
              by: api.by(req),
              ...(req.at ? { at: req.at } : {}),
              ...(req.entry ? { entry: req.entry } : {}),
            };
            return journeys(ctx).open(ask);
          }),
      ),
      journeysMove: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            journey: z.string().describe("The journey's id"),
            to: z.string().describe("A node id of its shape version"),
            reason: z.string().nullish().describe("Needed when no edge leads there"),
          }),
        },
        (ctx: restate.Context, req: JourneyMoveRequest) =>
          answer(async () => {
            const w = await api.workspace(req, "act");
            return journeys(ctx).move({
              client: w.client,
              journey: req.journey,
              to: req.to,
              by: api.by(req),
              ...(req.reason ? { reason: req.reason } : {}),
            });
          }),
      ),
      journeysDrop: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            journey: z.string().describe("The journey's id"),
            reason: z.string().describe("Why it ends here"),
          }),
        },
        (ctx: restate.Context, req: JourneyDropRequest) =>
          answer(async () => {
            const w = await api.workspace(req, "act");
            return journeys(ctx).drop({
              client: w.client,
              journey: req.journey,
              reason: req.reason,
              by: api.by(req),
            });
          }),
      ),
      journeysAssign: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            journey: z.string().describe("The journey's id"),
            to: z
              .string()
              .nullish()
              .describe("A team member's email; left out or null clears the owner"),
          }),
        },
        (ctx: restate.Context, req: JourneyAssignRequest) =>
          answer(async () => {
            const w = await api.workspace(req, "act");
            return journeys(ctx).assign({
              client: w.client,
              journey: req.journey,
              to: req.to ?? null,
              by: api.by(req),
            });
          }),
      ),
      termsAdd: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            offer: z.string().describe("An offer id from the registry"),
            plan: z.string().describe("A plan slug: standard, flat, partner-1"),
            from: z.string().describe("The first day it applies, YYYY-MM-DD"),
            body: z.looseObject({}).describe("The Terms JSON"),
            why: z.string().describe("Why, in a sentence"),
          }),
        },
        (ctx: restate.Context, req: TermsAddRequest) =>
          answer(() => ctx.run("terms add", () => answer(() => api.termsAdd(req)))),
      ),
      dealsSign: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            deal: z.string().describe("The deal's id"),
            plan: z.string().describe("A terms plan: standard, flat, partner-1"),
            force: z.boolean().nullish().describe("Change terms already set. Audited"),
          }),
        },
        (ctx: restate.Context, req: DealSignRequest) =>
          answer(() => ctx.run("deal sign", () => answer(() => api.dealsSign(req)))),
      ),
    },
  });
}
