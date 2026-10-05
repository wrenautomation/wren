/**
 * SmsConsole: a client's texting desk in the portal (O4). The `records*` reads are its threads,
 * from its own database, for anyone who may open that client, once `sms.texts` is installed.
 * `reply` is Wren's team only and goes through `SmsDesk.reply` with `client`, so the text is
 * journaled and leaves from the client's `SmsSender/<client>/fleet`. The Worker keeps the write
 * off the demo (`../console-routes.ts`).
 */
import * as restate from "@restatedev/restate-sdk";
import type { Client } from "@wren/core/clients";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  portalService,
  seesInternal,
} from "@wren/core/portal";
import { metaOf } from "@wren/core/records";
import {
  type ExportAsk,
  type GetAsk,
  type ListAsk,
  type RecordsApi,
  type StatsAsk,
  serveRecords,
} from "@wren/core/records/serve";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { type Db, snapshot } from "@wren/db";
import { z } from "zod";
import { TEXTS } from "../clients.js";
import { SMS_CONSOLE_ROUTES } from "../console-routes.js";
import { SMS_RECORDS } from "../records.js";
import type { SmsDeskService } from "./index.js";

export interface SmsConsoleDeps {
  /** Main: the client registry. */
  db: Db;
  /** A client's database. */
  open: (client: Pick<Client, "id" | "database">) => Db;
}

export interface ReplyRequest extends PortalRequest {
  /** The thread: its contact id, as the record shows it. */
  id: number;
  body: string;
}

/** The handlers as plain functions: the service wraps them, tests call them. */
export function smsConsoleApi({ db, open }: SmsConsoleDeps) {
  /** A client this viewer may open, with texts installed. */
  const texting = async (req: PortalRequest): Promise<Client> => {
    const client = await pickClient(db, req);
    if (!Object.hasOwn(client.products ?? {}, TEXTS))
      throw new PortalRefusal("texts are not installed", 404);
    return client;
  };
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) =>
    snapshot(open(await texting(req)), (tx) => use(serveRecords(SMS_RECORDS, tx)));
  return {
    recordsTypes: async (req: PortalRequest) => {
      await texting(req);
      return SMS_RECORDS.map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),
    /** What `SmsDesk.reply` gets, or the refusal: Wren's team, a real thread, some words. */
    replying: async (req: ReplyRequest) => {
      if (!seesInternal(req)) throw new PortalRefusal("that's for Wren's team", 403);
      const client = await texting(req);
      if (!Number.isSafeInteger(req.id) || req.id <= 0)
        throw new PortalRefusal("no such thread", 404);
      const body = typeof req.body === "string" ? req.body.trim() : "";
      if (!body) throw new PortalRefusal("type the text first", 400);
      return { client: client.id, contactId: req.id, body };
    },
  };
}

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };

export function makeSmsConsole(deps: SmsConsoleDeps) {
  const api = smsConsoleApi(deps);
  return portalService({
    name: "SmsConsole",
    main: deps.db,
    routes: SMS_CONSOLE_ROUTES,
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
      /** Text a client's thread from its sticky number; it leaves on the client's next tick. */
      reply: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            id: z.number().describe("The thread's id, as the record shows it"),
            body: z.string().describe("The text"),
          }),
          effect: "sends",
        },
        (ctx: restate.Context, req: ReplyRequest) =>
          answer(async () => {
            const ask = await api.replying(req);
            try {
              return await ctx.serviceClient<SmsDeskService>({ name: "SmsDesk" }).reply(ask);
            } catch (err) {
              // The desk's refusals (opted out, no such contact) are the viewer's answer.
              if (err instanceof restate.TerminalError) throw new PortalRefusal(err.message, 409);
              throw err;
            }
          }),
      ),
    },
  });
}

export type SmsConsoleService = ReturnType<typeof makeSmsConsole>;
