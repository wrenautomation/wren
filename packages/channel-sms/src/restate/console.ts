/**
 * SmsConsole: a client's texting desk in the portal (O4). The `records*` reads are its threads,
 * from its own database, for anyone who may open that client, once `sms.texts` is installed.
 * `reply` is Wren's team only and goes through `SmsDesk.reply` with `client`, so the text is
 * journaled and leaves from the client's `SmsSender/<client>/fleet`. The Worker keeps the write
 * off the demo (`../console-routes.ts`). `askReview` puts one customer into the client's live
 * review requests by hand.
 */
import * as restate from "@restatedev/restate-sdk";
import { CALL_OUTCOME_LABELS, outcomeIn } from "@wren/core/calls";
import type { Client } from "@wren/core/clients";
import {
  answer,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  portalService,
  type SignedViewer,
  seesInternal,
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
import { liveFor, spineEmit } from "@wren/core/spine";
import { atomic, type Db, setAuditActor, snapshot } from "@wren/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { TEXTS } from "../clients.js";
import { SMS_CONSOLE_APPS, SMS_CONSOLE_ROUTES } from "../console-routes.js";
import { toPhoneE164 } from "../phone.js";
import { SMS_RECORDS } from "../records.js";
import { cleanEmail, handSubject } from "../reviews.js";
import { CALL_OUTCOMES, type CallOutcome, speedRuns } from "../schema.js";
import { REVIEWS_FLOW } from "./answers.js";
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

export interface CallDoneRequest extends PortalRequest {
  /** Speed-to-lead runs, as the record shows their ids. */
  ids: (string | number)[];
  /** How it went: a code or its label ("No answer"); left out, just done. */
  outcome?: string | null;
}

export interface AskReviewRequest extends PortalRequest {
  name?: string | null;
  /** A mobile, an email, or both: at least one. */
  phone?: string | null;
  email?: string | null;
}

/** The outcome as the Done form's select says it. */
export const OUTCOME_LABELS = Object.fromEntries(
  CALL_OUTCOMES.map((o) => [o, CALL_OUTCOME_LABELS[o].label]),
) as Record<CallOutcome, string>;

const outcomeOf = (said: string | null | undefined): CallOutcome | null => {
  const code = outcomeIn(CALL_OUTCOMES, said);
  if (code === undefined)
    throw new PortalRefusal(`no such outcome: ${String(said).trim().slice(0, 40)}`, 400);
  return code;
};

/** The handlers as plain functions: the service wraps them, tests call them. */
export function smsConsoleApi({ db, open }: SmsConsoleDeps) {
  /** A client this viewer may open, with texts installed. */
  const texting = async (req: PortalRequest): Promise<Client> => {
    const client = await pickClient(db, req);
    if (!Object.hasOwn(client.products ?? {}, TEXTS))
      throw new PortalRefusal("texts are not installed", 404);
    return client;
  };
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const client = await texting(req);
    return snapshot(open(client), (tx) =>
      use(serveRecords(SMS_RECORDS, tx, undefined, fenceFor(req, client.id), meOf(req))),
    );
  };
  return {
    recordsTypes: async (req: PortalRequest) => {
      const fence = fenceFor(req, (await texting(req)).id);
      return SMS_RECORDS.filter((t) => !fence || opens(t, fence(t))).map((t) => metaOf(t, false));
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
    /**
     * Closes "Call now" on these runs: an open one (alerted, not done, not booked) takes the time,
     * the outcome and who; the rest are skipped.
     */
    callDone: async (req: CallDoneRequest, now: Date) => {
      const client = await texting(req);
      const by = (req.viewer as SignedViewer).email;
      const outcome = outcomeOf(req.outcome);
      const asked = Array.isArray(req.ids) ? req.ids.map(String) : [];
      const ids = asked.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
      if (!ids.length) throw new PortalRefusal("pick a lead", 400);
      const done = await atomic(open(client), async (tx) => {
        await setAuditActor(tx, by);
        return tx
          .update(speedRuns)
          .set({ callDoneAt: now, callOutcome: outcome, callDoneBy: by })
          .where(
            and(
              inArray(speedRuns.id, ids),
              eq(speedRuns.call, "alerted"),
              isNull(speedRuns.callDoneAt),
              isNull(speedRuns.bookedAt),
            ),
          )
          .returning({ id: speedRuns.id });
      });
      const closed = new Set(done.map((r) => String(r.id)));
      return { done: [...closed], skipped: asked.filter((id) => !closed.has(id)) };
    },
    /** One customer for review requests, by hand: the client's, with the template live. */
    askingReview: async (req: AskReviewRequest) => {
      const client = await texting(req);
      if (!(await liveFor(db, client.id, REVIEWS_FLOW)))
        throw new PortalRefusal("review requests aren't live: install them from the Shop", 409);
      const phone = typeof req.phone === "string" ? req.phone.trim() : "";
      const rawEmail = typeof req.email === "string" ? req.email.trim() : "";
      if (!phone && !rawEmail) throw new PortalRefusal("give a mobile or an email", 400);
      if (phone && !toPhoneE164(phone))
        throw new PortalRefusal("that isn't a US or Canadian number", 400);
      const email = rawEmail ? cleanEmail(rawEmail) : null;
      if (rawEmail && !email) throw new PortalRefusal("that isn't an email address", 400);
      const name = typeof req.name === "string" ? req.name.trim().slice(0, 120) || null : null;
      return { client: client.id, name, phone: phone || null, email };
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
    apps: SMS_CONSOLE_APPS,
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
      /** Close speed to lead's "Call now" on these leads, with how the call went. */
      callDone: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ids: z
              .array(z.union([z.string(), z.number()]))
              .describe("The leads' ids, as the record shows them"),
            outcome: z
              .string()
              .nullish()
              .describe("Reached, Voicemail, No answer or Wrong number; left out, just done"),
          }),
        },
        (ctx: restate.Context, req: CallDoneRequest) =>
          answer(async () => api.callDone(req, new Date(await ctx.date.now()))),
      ),
      /** Ask one customer for a review by hand: into the client's live review requests. */
      askReview: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            name: z.string().max(120).nullish().describe("The customer's name"),
            phone: z.string().max(40).nullish().describe("Their mobile"),
            email: z.string().max(254).nullish().describe("Their email"),
          }),
        },
        (ctx: restate.Context, req: AskReviewRequest) =>
          answer(async () => {
            const ask = await api.askingReview(req);
            const id = ctx.rand.uuidv4();
            spineEmit(ctx, {
              client: ask.client,
              workflow: REVIEWS_FLOW,
              from: "in.customers",
              onlyLive: true,
              events: [
                {
                  subject: handSubject(id),
                  kind: "lead",
                  data: { name: ask.name, phone: ask.phone, email: ask.email, source: "hand" },
                },
              ],
            });
            return { asked: true };
          }),
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
