/**
 * MarketingConsole: a client's Marketing numbers in the portal (designs/2026-10-07-per-client-runs.md).
 * The `records*` reads are what its posting, ads and search loops wrote into its own database,
 * for anyone who may open that client, once `marketing.stats` is installed. A draft's verdict
 * goes to `ContentDesk/<client>/desk`, only from whoever the client's approver is (Wren's team by
 * default). Nothing here posts: an approved draft waits for the client's scheduler and its live
 * flag. Wren's own Marketing is the console's.
 */
import * as restate from "@restatedev/restate-sdk";
import { mayApprove } from "@wren/core/access";
import type { Client } from "@wren/core/clients";
import {
  MARKETING_CONSOLE_APPS,
  MARKETING_CONSOLE_ROUTES,
} from "@wren/core/marketing/console-routes";
import {
  accessOf,
  answer,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalService,
  whoIs,
} from "@wren/core/portal";
import { metaOf, type RecordType } from "@wren/core/records";
import {
  type ExportAsk,
  fenceFor,
  type GetAsk,
  type ListAsk,
  opens,
  type RecordsApi,
  type StatsAsk,
  serveRecords,
} from "@wren/core/records/serve";
import { clientKey, PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { type Db, snapshot } from "@wren/db";
import { z } from "zod";
import { type ContentDesk, DESK_UNIT } from "./desk.js";

export const MARKETING_STATS = "marketing.stats";

export interface MarketingConsoleDeps {
  /** Main: the client registry. */
  db: Db;
  /** A client's database. */
  open: (client: Pick<Client, "id" | "database">) => Db;
  /** The record types a client's Marketing serves: what its loops write. */
  records: readonly RecordType[];
}

export interface DraftsRequest extends PortalRequest {
  /** Draft ids, as the record shows them. */
  ids: string[];
}
export interface RedraftRequest extends PortalRequest {
  draftId: string;
  note: string;
}

const NOT_YOURS = { wren: "Wren's team approves these", client: "the client approves these" };

/** The handlers as plain functions: the service wraps them, tests call them. */
export function marketingConsoleApi({ db, open, records }: MarketingConsoleDeps) {
  /** A client this viewer may open, with Marketing installed. */
  const installed = async (req: PortalRequest): Promise<Client> => {
    const client = await pickClient(db, req);
    if (!Object.hasOwn(client.products ?? {}, MARKETING_STATS))
      throw new PortalRefusal("Marketing numbers is not installed", 404);
    return client;
  };
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const client = await installed(req);
    return snapshot(open(client), (tx) =>
      use(serveRecords(records, tx, undefined, fenceFor(req, client.id))),
    );
  };
  return {
    recordsTypes: async (req: PortalRequest) => {
      const fence = fenceFor(req, (await installed(req)).id);
      return records.filter((t) => !fence || opens(t, fence(t))).map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),
    /** The client's desk key, or the refusal: never the demo, installed, its approver only. */
    deciding: async (req: PortalRequest): Promise<string> => {
      const { client } = await pickForWrite(db, req);
      if (!Object.hasOwn(client.products ?? {}, MARKETING_STATS))
        throw new PortalRefusal("Marketing numbers is not installed", 404);
      const v = req.viewer;
      const who =
        !isDemo(v) && !v.access && !v.operator ? await whoIs(db, v, client.id) : accessOf(req);
      if (!mayApprove(who, client.id, client.approver))
        throw new PortalRefusal(NOT_YOURS[client.approver === "client" ? "client" : "wren"], 403);
      return clientKey(client.id, DESK_UNIT);
    },
  };
}

/** Draft ids from a browser: strings, one page's worth. */
const idsOf = (v: unknown): string[] => {
  if (!Array.isArray(v) || !v.length || v.length > 500)
    throw new PortalRefusal("pick a draft first", 400);
  return v.map(String);
};

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };
const IDS = {
  input: z.looseObject({
    ...PORTAL_FIELDS,
    ids: z.array(z.union([z.string(), z.number()])).describe("Draft ids"),
  }),
};

/** The desk's refusals (not waiting, no model, no About) are the viewer's answer. */
async function desk<T>(go: () => Promise<T>): Promise<T> {
  try {
    return await go();
  } catch (err) {
    if (err instanceof restate.TerminalError) throw new PortalRefusal(err.message, 409);
    throw err;
  }
}

export function makeMarketingConsole(deps: MarketingConsoleDeps) {
  const api = marketingConsoleApi(deps);
  const deskOf = (ctx: restate.Context, key: string) =>
    ctx.objectClient<ContentDesk>({ name: "ContentDesk" }, key);
  return portalService({
    name: "MarketingConsole",
    main: deps.db,
    routes: MARKETING_CONSOLE_ROUTES,
    apps: MARKETING_CONSOLE_APPS,
    unnamed: "first",
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
      /** Yes on the client's drafts: each takes its platform's next slot; posting waits on its live flag. */
      approveDraft: serviceHandler(IDS, (ctx: restate.Context, req: DraftsRequest) =>
        answer(async () => {
          const ids = idsOf(req.ids);
          const key = await ctx.run("check", () => answer(() => api.deciding(req)));
          return desk(() => deskOf(ctx, key).approve({ ids }));
        }),
      ),
      /** No on the client's drafts. */
      rejectDraft: serviceHandler(IDS, (ctx: restate.Context, req: DraftsRequest) =>
        answer(async () => {
          const ids = idsOf(req.ids);
          const key = await ctx.run("check", () => answer(() => api.deciding(req)));
          return desk(() => deskOf(ctx, key).reject({ ids }));
        }),
      ),
      /** Rewrite one draft from the note, on the client's own model gate. */
      redraft: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            draftId: z.union([z.string(), z.number()]).describe("The draft's id"),
            note: z.string().describe("What to change"),
          }),
        },
        (ctx: restate.Context, req: RedraftRequest) =>
          answer(async () => {
            const note = typeof req.note === "string" ? req.note.trim() : "";
            if (!note) throw new PortalRefusal("say what to change", 400);
            const key = await ctx.run("check", () => answer(() => api.deciding(req)));
            return desk(() => deskOf(ctx, key).redraft({ draftId: String(req.draftId), note }));
          }),
      ),
    },
  });
}

export type MarketingConsoleService = ReturnType<typeof makeMarketingConsole>;
