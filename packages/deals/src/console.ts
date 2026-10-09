/**
 * DealsConsole: the portal's Opportunities app (designs/2026-10-09-opportunities.md, "Portal"),
 * for Wren's team in Wren's workspace and for a client on its own.
 *
 * - `records*`: the owner's deals as records, with the owner's stages.
 * - `board`: the owner's pipelines and one pipeline's deals, for the board.
 * - `create`, `edit`, `assign`, `remove`: a deal's own fields.
 * - `move`, `won`, `lost`: a stage change. Each one moved fires `trigger.deal` on the spine.
 * - `pipelineSave`, `pipelineDrop`: a pipeline and its stages.
 *
 * Nothing here sends: a workflow that hears a move does what it says.
 */
import type * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import {
  answer,
  canAt,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  portalService,
  type SignedViewer,
} from "@wren/core/portal";
import { metaOf } from "@wren/core/records";
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
import type { Fired, FireTriggers } from "@wren/core/spine";
import { type Db, snapshot } from "@wren/db";
import { z } from "zod";
import { DEALS_CONSOLE_APPS, DEALS_CONSOLE_ROUTES } from "./console-routes.js";
import { type DealRow, dealRecordFor, dealRows } from "./records.js";
import type { DealPipeline, StageKind } from "./schema.js";
import {
  createDeal,
  type DealFields,
  DealRefusal,
  dealsById,
  deleteDeals,
  dropPipeline,
  type Moved,
  moveDeals,
  pipelineById,
  pipelinesOf,
  saveDeal,
  savePipeline,
} from "./store.js";

export interface DealsConsoleDeps {
  main: Db;
  /** The spine's ear: `spineFire` on the worker; unset where no Spine runs. */
  fire?: FireTriggers;
}

export interface BoardRequest extends PortalRequest {
  /** The pipeline to show; the owner's first when left out. */
  pipeline?: string | null;
}
export interface DealRequest extends PortalRequest, DealFields {
  pipeline?: string | null;
  stage?: string | null;
}
export interface EditRequest extends PortalRequest, DealFields {
  id?: string;
  ids?: string[];
}
export interface IdsRequest extends PortalRequest {
  ids: string[];
}
export interface MoveRequest extends IdsRequest {
  /** A stage key of each deal's pipeline. */
  stage: string;
}
export interface AssignRequest extends IdsRequest {
  owner?: string | null;
}
export interface PipelineRequest extends PortalRequest {
  id?: string | null;
  name: string;
  stages: unknown;
}
export interface PipelineDropRequest extends PortalRequest {
  id: string;
}

export interface Board {
  pipelines: Pick<DealPipeline, "id" | "name" | "stages">[];
  pipeline: string;
  deals: DealRow[];
}

const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;

function refusal(err: unknown): never {
  if (err instanceof DealRefusal) throw new PortalRefusal(err.message, err.status);
  throw err;
}

/** A move as a Deal trigger hears it: about the deal, its contact's email riding along. */
export function dealFired(m: Moved): Fired {
  const d = m.deal;
  const change = m.stage.kind === "open" ? "moved" : m.stage.kind;
  return {
    client: d.client,
    facts: { trigger: "trigger.deal", change, stage: m.stage.key },
    about: d.contactEmail ? [d.contactEmail] : [],
    event: {
      subject: `deal:${d.id}`,
      kind: "deal",
      data: {
        deal: d.id,
        name: d.name,
        pipeline: d.pipeline,
        from: m.from,
        stage: m.stage.key,
        stage_label: m.stage.label,
        status: d.status,
        value_cents: d.valueCents,
        currency: d.currency,
        email: d.contactEmail,
        phone: d.contactPhone,
        contact: d.contactName,
        owner: d.owner,
        source: d.source,
        source_ref: d.sourceRef,
      },
    },
  };
}

/** The handlers as plain calls: the service wraps them, tests call them. */
export function dealsConsoleApi(deps: DealsConsoleDeps) {
  const { main } = deps;
  /**
   * Whose deals a request is about: the client it names, else Wren's for Wren's team, else the
   * login's own client. Refused past what the viewer may `p` in Opportunities there.
   */
  const ownerFor = async (req: PortalRequest, p: "read" | "act"): Promise<string | null> => {
    const v = req.viewer;
    const named = req.client && req.client !== WREN ? req.client : null;
    const owner = named || isDemo(v) || !v.operator ? (await pickClient(main, req)).id : null;
    if (p === "act" && isDemo(v)) throw new PortalRefusal("the demo is read-only", 403);
    if (!(await canAt(main, req, p, { client: owner ?? WREN, app: "deals", channel: null })))
      throw new PortalRefusal(p === "read" ? "no access" : "your role can't do that here", 403);
    return owner;
  };
  /** A name on the change: the demo writes nothing. */
  const who = (req: PortalRequest) => {
    if (isDemo(req.viewer) || !by(req)) throw new PortalRefusal("sign in to change deals", 403);
    return by(req);
  };
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const owner = await ownerFor(req, "read");
    return snapshot(main, (tx) =>
      use(
        serveRecords(
          [dealRecordFor(owner)],
          tx,
          undefined,
          fenceFor(req, owner ?? WREN),
          meOf(req),
        ),
      ),
    );
  };
  /** Each picked deal, all the owner's, refused whole if one isn't. */
  const picked = async (req: IdsRequest, owner: string | null) => {
    const ids = [...new Set((req.ids ?? []).map(String))];
    if (!ids.length) throw new PortalRefusal("nothing picked", 404);
    const rows = await dealsById(main, ids);
    if (rows.length !== ids.length || rows.some((d) => d.client !== owner))
      throw new PortalRefusal("no such deal", 404);
    return ids;
  };

  return {
    recordsTypes: async (req: PortalRequest) => {
      const owner = await ownerFor(req, "read");
      const fence = fenceFor(req, owner ?? WREN);
      return [dealRecordFor(owner)]
        .filter((t) => !fence || opens(t, fence(t)))
        .map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),

    /** The owner's pipelines (the default made on the first look) and one's deals. */
    board: async (req: BoardRequest): Promise<Board> => {
      const owner = await ownerFor(req, "read");
      const pipes = await pipelinesOf(main, owner, by(req) ?? "system");
      const pipe = (req.pipeline && pipes.find((p) => p.id === req.pipeline)) || pipes[0];
      if (!pipe) throw new PortalRefusal("no pipeline", 404);
      return {
        pipelines: pipes.map((p) => ({ id: p.id, name: p.name, stages: p.stages })),
        pipeline: pipe.id,
        deals: await dealRows(main, owner, pipes, { pipeline: pipe.id }),
      };
    },

    create: async (req: DealRequest): Promise<Moved> => {
      const owner = await ownerFor(req, "act");
      return createDeal(main, { ...req, owner_: owner, source: "manual", by: who(req) }).catch(
        refusal,
      );
    },
    /** One deal's fields, or (with `ids`) the same fields on each picked. */
    edit: async (req: EditRequest) => {
      const owner = await ownerFor(req, "act");
      const ids = await picked({ ...req, ids: req.ids ?? (req.id ? [req.id] : []) }, owner);
      const { id: _id, ids: _ids, ...fields } = req;
      const out = [];
      for (const id of ids)
        out.push(await saveDeal(main, { ...pick(fields), id, by: who(req) }).catch(refusal));
      return { done: out.map((d) => d.id) };
    },
    assign: async (req: AssignRequest) => {
      const owner = await ownerFor(req, "act");
      const ids = await picked(req, owner);
      for (const id of ids)
        await saveDeal(main, { id, owner: req.owner ?? null, by: who(req) }).catch(refusal);
      return { done: ids };
    },
    remove: async (req: IdsRequest) => {
      const owner = await ownerFor(req, "act");
      return { deleted: await deleteDeals(main, await picked(req, owner)) };
    },
    move: async (req: MoveRequest): Promise<Moved[]> => {
      const owner = await ownerFor(req, "act");
      const ids = await picked(req, owner);
      return moveDeals(main, { ids, to: { stage: String(req.stage ?? "") }, by: who(req) }).catch(
        refusal,
      );
    },
    close: async (req: IdsRequest, kind: Exclude<StageKind, "open">): Promise<Moved[]> => {
      const owner = await ownerFor(req, "act");
      const ids = await picked(req, owner);
      return moveDeals(main, { ids, to: { kind }, by: who(req) }).catch(refusal);
    },

    pipelineSave: async (req: PipelineRequest) => {
      const owner = await ownerFor(req, "act");
      if (req.id) {
        const p = await pipelineById(main, req.id);
        if (!p || p.client !== owner) throw new PortalRefusal("no such pipeline", 404);
      }
      const p = await savePipeline(main, {
        owner,
        id: req.id ?? null,
        name: req.name,
        stages: req.stages,
        by: who(req),
      }).catch(refusal);
      return { id: p.id, name: p.name, stages: p.stages };
    },
    pipelineDrop: async (req: PipelineDropRequest) => {
      const owner = await ownerFor(req, "act");
      who(req);
      await dropPipeline(main, owner, String(req.id ?? "")).catch(refusal);
      return { dropped: req.id };
    },
  };
}

/** Only the deal fields a request carries. */
const FIELD_KEYS = [
  "name",
  "value",
  "contactName",
  "contactEmail",
  "contactPhone",
  "owner",
  "note",
  "nextOn",
] as const satisfies readonly (keyof DealFields)[];
const pick = (f: Record<string, unknown>): DealFields =>
  Object.fromEntries(FIELD_KEYS.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };
const IDS = z.array(z.string()).describe("The deals' ids");
const FIELDS = {
  name: z.string().nullish().describe("What the deal is: a firm, a job"),
  value: z.union([z.string(), z.number()]).nullish().describe("Dollars, as 1200"),
  contactName: z.string().nullish(),
  contactEmail: z.string().nullish(),
  contactPhone: z.string().nullish(),
  owner: z.string().nullish().describe("The email of who works it"),
  note: z.string().nullish(),
  nextOn: z.string().nullish().describe("A day to follow up, as 2026-10-20"),
};

export function makeDealsConsole(deps: DealsConsoleDeps) {
  const api = dealsConsoleApi(deps);
  /** Each moved deal told to the spine, after the move is kept. */
  const fireAll = (ctx: restate.Context, moved: readonly Moved[]) => {
    if (deps.fire) for (const m of moved) deps.fire(ctx, dealFired(m));
  };
  const brief = (m: Moved) => ({ id: m.deal.id, stage: m.stage.key, status: m.deal.status });
  const moving =
    (name: string, run: (req: never) => Promise<Moved[]>) =>
    async (ctx: restate.Context, req: never) =>
      answer(async () => {
        const moved = await ctx.run(name, () => answer(() => run(req)));
        fireAll(ctx, moved);
        return { done: moved.map(brief) };
      });
  return portalService({
    name: "DealsConsole",
    main: deps.main,
    routes: DEALS_CONSOLE_ROUTES,
    apps: DEALS_CONSOLE_APPS,
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
      board: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            pipeline: z.string().nullish().describe("The pipeline's id; the first when left out"),
          }),
        },
        (_: restate.Context, req: BoardRequest) => answer(() => api.board(req)),
      ),
      create: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ...FIELDS,
            name: z.string().describe("What the deal is: a firm, a job"),
            pipeline: z.string().nullish().describe("The pipeline's id; the first when left out"),
            stage: z.string().nullish().describe("A stage key; the first open one when left out"),
          }),
        },
        async (ctx: restate.Context, req: DealRequest) =>
          answer(async () => {
            const m = await ctx.run("create", () => answer(() => api.create(req)));
            fireAll(ctx, [m]);
            return brief(m);
          }),
      ),
      edit: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ...FIELDS,
            id: z.string().nullish(),
            ids: IDS.nullish(),
          }),
        },
        (ctx: restate.Context, req: EditRequest) =>
          answer(() => ctx.run("edit", () => answer(() => api.edit(req)))),
      ),
      assign: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ids: IDS,
            owner: z.string().nullish().describe("Who works them; empty clears it"),
          }),
        },
        (ctx: restate.Context, req: AssignRequest) =>
          answer(() => ctx.run("assign", () => answer(() => api.assign(req)))),
      ),
      remove: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ids: IDS }) },
        (ctx: restate.Context, req: IdsRequest) =>
          answer(() => ctx.run("remove", () => answer(() => api.remove(req)))),
      ),
      move: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ids: IDS,
            stage: z.string().describe("The stage's key"),
          }),
        },
        moving("move", (req: MoveRequest) => api.move(req)),
      ),
      won: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ids: IDS }) },
        moving("won", (req: IdsRequest) => api.close(req, "won")),
      ),
      lost: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, ids: IDS }) },
        moving("lost", (req: IdsRequest) => api.close(req, "lost")),
      ),
      pipelineSave: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            id: z.string().nullish().describe("The pipeline's id; a new one when left out"),
            name: z.string(),
            stages: z
              .array(
                z.looseObject({
                  key: z.string().nullish(),
                  label: z.string(),
                  kind: z.enum(["open", "won", "lost"]).nullish(),
                }),
              )
              .describe("In order; one won and one lost"),
          }),
        },
        (ctx: restate.Context, req: PipelineRequest) =>
          answer(() => ctx.run("pipeline", () => answer(() => api.pipelineSave(req)))),
      ),
      pipelineDrop: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS, id: z.string() }) },
        (ctx: restate.Context, req: PipelineDropRequest) =>
          answer(() => ctx.run("drop", () => answer(() => api.pipelineDrop(req)))),
      ),
    },
  });
}
export type DealsConsoleService = ReturnType<typeof makeDealsConsole>;
