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
 * - `journeysOpen`, `journeysMove`, `journeysDrop`: the `Journeys` service, as the operator.
 * - `dealsSign`: a deal's terms, once; a change needs `force` and is audited.
 * - `termsAdd`: the next version of one plan of one offer, as `wren terms add` (same checks).
 *
 * Every write goes through the store or the `Journeys` service, never a second path.
 */
import type * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import type { Client } from "@wren/core/clients";
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
import { type Db, snapshot } from "@wren/db";
import { OFFER_IDS, OFFERS, type Terms } from "@wren/offers";
import { z } from "zod";
import { PIPELINE_CONSOLE_APPS, PIPELINE_CONSOLE_ROUTES } from "./console-routes.js";
import type { ShapeBody } from "./model.js";
import { signDeal } from "./moves.js";
import { PIPELINE_RECORDS } from "./records.js";
import { JOURNEYS, type OpenRequest as JourneyOpen, type JourneysApi } from "./restate.js";
import { exportShape, importShape, parseShape } from "./shape-file.js";
import { startShape } from "./starter.js";
import {
  addTerms,
  diffShapes,
  newestShape,
  Refused,
  saveShape,
  shapeVersionsOf,
  syncOffers,
} from "./store.js";

export interface PipelineConsoleDeps {
  /** Main: the client registry, and Wren's own workspace. */
  db: Db;
  /** A client's database. */
  open: (client: Pick<Client, "id" | "database">) => Db;
  /** Left out: `PIPELINE_RECORDS`. */
  records?: readonly RecordType[];
}

export interface ShapeVersionRequest extends PortalRequest {
  /** Why it changed. */
  note: string;
  body: unknown;
  /** Where journeys on a node the body drops go: `{ oldNode: newNode }`. */
  moves?: Record<string, string>;
}
export interface ShapeDiffRequest extends PortalRequest {
  /** Version numbers. */
  a: number;
  b: number;
}
export interface ShapeImportRequest extends PortalRequest {
  /** The shape file's YAML text. */
  text: string;
  /** The version's note when the file has none. */
  note?: string;
}
export interface ShapeExportRequest extends PortalRequest {
  /** The body to write as a file: the Map's draft, or a version it holds. */
  body: unknown;
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
export function pipelineConsoleApi({ db, open, records = PIPELINE_RECORDS }: PipelineConsoleDeps) {
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
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const w = await workspace(req, "read");
    return snapshot(w.db, (tx) =>
      use(serveRecords(records, tx, undefined, fenceFor(req, w.client ?? WREN), meOf(req))),
    );
  };
  const bodyOf = (v: unknown): ShapeBody => {
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
      return records.filter((t) => !fence || opens(t, fence(t))).map((t) => metaOf(t, false));
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
      const row = await refused(() =>
        saveShape(w.db, {
          body: bodyOf(req.body),
          note: String(req.note ?? ""),
          by: by(req),
          triggers: TRIGGER_IDS,
          ...(req.moves ? { moves: req.moves } : {}),
        }),
      );
      return { version: row.number };
    },
    shapeDiff: async (req: ShapeDiffRequest) => {
      const w = await workspace(req, "read");
      const all = await shapeVersionsOf(w.db);
      const at = (n: number) => {
        const v = all.find((x) => x.number === Number(n));
        if (!v) throw new PortalRefusal(`There is no shape version ${n}.`, 400);
        return v;
      };
      const [a, b] = [at(req.a), at(req.b)];
      // The bodies too: the Map draws the two shapes as one, a removed node beside the added.
      return {
        a: a.number,
        b: b.number,
        diff: diffShapes(a.body, b.body),
        bodies: [a.body, b.body],
      };
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
      await workspace(req, "read");
      return { text: exportShape(bodyOf(req.body)) };
    },
    shapePreview: async (req: ShapePreviewRequest) => {
      const w = await workspace(req, "read");
      const file = await refused(async () => parseShape(String(req.text ?? "")));
      const newest = await newestShape(w.db);
      const none: ShapeBody = { name: file.body.name, nodes: [], edges: [] };
      // Compared as an import would save it: the file against the newest version.
      return {
        a: newest?.number ?? null,
        diff: diffShapes(newest?.body ?? none, file.body),
        bodies: [newest?.body ?? none, file.body],
        note: file.note ?? null,
        moves: file.moves ?? null,
      };
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

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };

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
            body: z.looseObject({}).describe("The shape body: name, nodes, edges"),
            moves: z
              .record(z.string(), z.string())
              .nullish()
              .describe("Where journeys on a dropped node go: { oldNode: newNode }"),
          }),
        },
        (ctx: restate.Context, req: ShapeVersionRequest) =>
          answer(() => ctx.run("shape version", () => answer(() => api.shapeVersion(req)))),
      ),
      shapeDiff: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            a: z.number().describe("A shape version number"),
            b: z.number().describe("Another shape version number"),
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
          answer(() => ctx.run("shape import", () => answer(() => api.shapeImport(req)))),
      ),
      shapeStart: serviceHandler(
        { input: z.looseObject({ ...PORTAL_FIELDS }) },
        (ctx: restate.Context, req: PortalRequest) =>
          answer(() => ctx.run("shape start", () => answer(() => api.shapeStart(req)))),
      ),
      shapeExport: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            body: z.looseObject({}).describe("The shape body: name, nodes, edges"),
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
