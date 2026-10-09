/**
 * MarketingConsole: a client's Marketing numbers in the portal (designs/2026-10-07-per-client-runs.md).
 * The `records*` reads are what its posting, ads and search loops wrote into its own database,
 * for anyone who may open that client, once `marketing.stats` is installed. A draft's verdict
 * goes to `ContentDesk/<client>/desk`, only from whoever the client's approver is (Wren's team by
 * default). Nothing here posts: an approved draft waits for the client's scheduler and its live
 * flag. Its Inbox: the client's own threads through InboxDesk, with the client set to the one
 * the guard opened. Wren's own Marketing is the console's.
 */
import * as restate from "@restatedev/restate-sdk";
import { mayApprove } from "@wren/core/access";
import type { Client } from "@wren/core/clients";
import { REJECT_REASONS, rejectWhy } from "@wren/core/draft-record";
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
  meOf,
  opens,
  type RecordsApi,
  type StatsAsk,
  serveRecords,
} from "@wren/core/records/serve";
import { clientKey, PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import { type Db, snapshot } from "@wren/db";
import { z } from "zod";
import type { ReplyOption } from "../inbox/conversation.js";
import { clientAccounts, withRoutes } from "../inbox/routes.js";
import {
  PROMO_PIECES,
  PROMO_PLATFORMS,
  type PromoPiece,
  type PromoPlatform,
  promotable,
} from "../promo.js";
import { INBOX_CHANNELS, INBOX_STATUSES, type InboxChannel, type InboxStatus } from "../schema.js";
import { type ContentDesk, clientDrafting, DESK_UNIT, type FunnelRequest } from "./desk.js";
import type { InboxDesk } from "./inbox-desk.js";

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
export interface RejectRequest extends DraftsRequest {
  reason?: string | null;
  note?: string | null;
}
export interface RedraftRequest extends PortalRequest {
  draftId: string;
  note: string;
}

export interface FieldsRequest extends PortalRequest {
  draftId: string;
  patch: Record<string, unknown>;
}
export interface FunnelConsoleRequest extends PortalRequest {
  draftId: string;
  stage?: string | null;
  to?: string | null;
  video?: string | null;
  linked?: string | boolean | null;
}
export interface PromoteRequest extends PortalRequest {
  /** The client's YouTube post. */
  draftId: string;
  /** Posts, an X thread, a carousel; none: posts. */
  pieces?: PromoPiece[] | null;
}
export interface SlidesRequest extends PortalRequest {
  draftId: string;
  slides?: { title: string; lines: string[] }[] | null;
  draw?: boolean | null;
}
export interface AttachRequest extends PortalRequest {
  draftId: string;
  field: string;
  name: string;
  data: string;
}

const NOT_YOURS = { wren: "Wren's team approves these", client: "the client approves these" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The handlers as plain functions: the service wraps them, tests call them. */
export function marketingConsoleApi({ db, open, records }: MarketingConsoleDeps) {
  /** A client this viewer may open, with Marketing installed. */
  const installed = async (req: PortalRequest): Promise<Client> => {
    const client = await pickClient(db, req);
    if (!Object.hasOwn(client.products ?? {}, MARKETING_STATS))
      throw new PortalRefusal("Marketing numbers is not installed", 404);
    return client;
  };
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) =>
    readAt(await installed(req), req, use);
  const readAt = <T>(client: Client, req: PortalRequest, use: (api: RecordsApi) => Promise<T>) =>
    snapshot(open(client), (tx) =>
      use(serveRecords(records, tx, undefined, fenceFor(req, client.id), meOf(req))),
    );
  return {
    recordsTypes: async (req: PortalRequest) => {
      const fence = fenceFor(req, (await installed(req)).id);
      return records.filter((t) => !fence || opens(t, fence(t))).map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    /** A row; an Inbox thread's reply options say which need the client's own account. */
    recordsGet: async (req: PortalRequest & GetAsk) => {
      const client = await installed(req);
      const out = await readAt(client, req, (r) => r.get(req));
      const c = (out.detail as { conversation?: { options?: ReplyOption[] } } | null)?.conversation;
      if (c?.options) c.options = withRoutes(c.options, await clientAccounts(db, client.id));
      return out;
    },
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),
    /**
     * The client whose Inbox a change is on: never the demo, Marketing installed. InboxDesk
     * then checks the viewer on the thread.
     */
    inboxing: async (req: PortalRequest): Promise<string> => {
      const { client } = await pickForWrite(db, req);
      if (!Object.hasOwn(client.products ?? {}, MARKETING_STATS))
        throw new PortalRefusal("Marketing numbers is not installed", 404);
      return client.id;
    },
    /** The client's desk key, or the refusal: never the demo, installed, its approver only. */
    deciding: async (req: PortalRequest): Promise<string> => (await decide(req)).key,
    /**
     * A promo of the client's YouTube post, checked before it starts: its approver, its plan and
     * model gate open, the post a video approved to go up. The platforms are its own logins'.
     */
    promoting: async (req: PromoteRequest) => {
      const { client, key } = await decide(req);
      const draftId = String(req.draftId ?? "");
      if (!UUID.test(draftId)) throw new PortalRefusal("pick a YouTube post first", 400);
      const plan = await clientDrafting(db, client.id);
      if (!plan.ok) throw new PortalRefusal(plan.why, 409);
      try {
        await promotable(open(client), draftId);
      } catch (err) {
        throw new PortalRefusal((err as Error).message, 409);
      }
      const platforms: PromoPlatform[] = PROMO_PLATFORMS.filter((p) => plan.platforms.includes(p));
      if (!platforms.length)
        throw new PortalRefusal("none of this client's logins takes a promo yet", 409);
      return { key, draftId, platforms };
    },
  };

  async function decide(req: PortalRequest) {
    const { client } = await pickForWrite(db, req);
    if (!Object.hasOwn(client.products ?? {}, MARKETING_STATS))
      throw new PortalRefusal("Marketing numbers is not installed", 404);
    const v = req.viewer;
    const who =
      !isDemo(v) && !v.access && !v.operator ? await whoIs(db, v, client.id) : accessOf(req);
    if (!mayApprove(who, client.id, client.approver))
      throw new PortalRefusal(NOT_YOURS[client.approver === "client" ? "client" : "wren"], 403);
    return { client, key: clientKey(client.id, DESK_UNIT) };
  }
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
const REJECT = {
  input: z.looseObject({
    ...PORTAL_FIELDS,
    ids: z.array(z.union([z.string(), z.number()])).describe("Draft ids"),
    reason: z
      .string()
      .nullish()
      .describe(`Why, as a quick pick: ${REJECT_REASONS.join(", ")}`),
    note: z.string().nullish().describe("Why, in a few words"),
  }),
};

const THREAD = z.string().min(3).max(80).describe("The Inbox thread's id: text:8, reply:6");
const ON_THREAD = (more: z.ZodRawShape = {}) => ({
  input: z.looseObject({ ...PORTAL_FIELDS, thread: THREAD, ...more }),
});
const WHERE = {
  channel: z.enum(INBOX_CHANNELS).describe("email, text, dm or comment"),
  target: z.string().min(1).max(80).describe("The channel's id from the thread's options"),
};
const ASKED = {
  input: z.looseObject({ ...PORTAL_FIELDS, id: z.number().describe("The asked reply") }),
};

export interface ThreadRequest extends PortalRequest {
  thread: string;
}
export interface InboxReplyRequest extends ThreadRequest {
  channel: InboxChannel;
  target: string;
  body: string;
}

const inboxClient = (ctx: restate.Context) => ctx.serviceClient<InboxDesk>({ name: "InboxDesk" });
type InboxClient = ReturnType<typeof inboxClient>;

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
  /**
   * InboxDesk on the client's own database: the client is the one the guard let this viewer
   * open, never one the request names past that, and never Wren's.
   */
  const inbox = <T>(
    ctx: restate.Context,
    req: PortalRequest,
    go: (d: InboxClient, at: { client: string; viewer: PortalRequest["viewer"] }) => Promise<T>,
  ) =>
    answer(async () => {
      const client = await ctx.run("check", () => answer(() => api.inboxing(req)));
      return desk(() => go(inboxClient(ctx), { client, viewer: req.viewer }));
    });
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
          return desk(() => deskOf(ctx, key).approve({ ids, viewer: req.viewer }));
        }),
      ),
      /** No on the client's drafts, with an optional why for the draft record. */
      rejectDraft: serviceHandler(REJECT, (ctx: restate.Context, req: RejectRequest) =>
        answer(async () => {
          const ids = idsOf(req.ids);
          let why: ReturnType<typeof rejectWhy>;
          try {
            why = rejectWhy(req);
          } catch (err) {
            throw new PortalRefusal((err as Error).message, 400);
          }
          const key = await ctx.run("check", () => answer(() => api.deciding(req)));
          return desk(() => deskOf(ctx, key).reject({ ids, ...why, viewer: req.viewer }));
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
      /** A client draft's fields (its platform's shape), from its approver. */
      draftFields: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            draftId: z.union([z.string(), z.number()]).describe("The draft's id"),
            patch: z.record(z.string(), z.unknown()).describe("Fields; null unsets one"),
          }),
        },
        (ctx: restate.Context, req: FieldsRequest) =>
          answer(async () => {
            const key = await ctx.run("check", () => answer(() => api.deciding(req)));
            return desk(() =>
              deskOf(ctx, key).fields({
                draftId: String(req.draftId),
                patch: req.patch,
                viewer: req.viewer,
              }),
            );
          }),
      ),
      /** A reply on the client's thread: sent, or asked in its To approve (InboxDesk's gate). */
      inboxReply: serviceHandler(
        ON_THREAD({ ...WHERE, body: z.string().describe("The words") }),
        (ctx: restate.Context, req: InboxReplyRequest) =>
          inbox(ctx, req, (d, at) =>
            d.reply({
              ...at,
              thread: req.thread,
              channel: req.channel,
              target: req.target,
              body: req.body,
            }),
          ),
      ),
      /** Ask for a yes: the reply waits in the client's To approve. */
      inboxAsk: serviceHandler(
        ON_THREAD({ ...WHERE, body: z.string().describe("The words") }),
        (ctx: restate.Context, req: InboxReplyRequest) =>
          inbox(ctx, req, (d, at) =>
            d.ask({
              ...at,
              thread: req.thread,
              channel: req.channel,
              target: req.target,
              body: req.body,
            }),
          ),
      ),
      /** Words to start from, signed by the client, on its own models gate. */
      inboxSuggest: serviceHandler(
        ON_THREAD(WHERE),
        (ctx: restate.Context, req: Omit<InboxReplyRequest, "body">) =>
          inbox(ctx, req, (d, at) =>
            d.suggest({ ...at, thread: req.thread, channel: req.channel, target: req.target }),
          ),
      ),
      /** A note for the client's team; an `@` teammate gets a mention. */
      inboxNote: serviceHandler(
        ON_THREAD({ body: z.string().describe("The note") }),
        (ctx: restate.Context, req: ThreadRequest & { body: string }) =>
          inbox(ctx, req, (d, at) => d.note({ ...at, thread: req.thread, body: req.body })),
      ),
      inboxAssign: serviceHandler(
        ON_THREAD({
          assignee: z.string().nullish().describe("A teammate's email; empty is nobody"),
        }),
        (ctx: restate.Context, req: ThreadRequest & { assignee?: string | null }) =>
          inbox(ctx, req, (d, at) =>
            d.assign({ ...at, thread: req.thread, assignee: req.assignee ?? null }),
          ),
      ),
      inboxTake: serviceHandler(ON_THREAD(), (ctx: restate.Context, req: ThreadRequest) =>
        inbox(ctx, req, (d, at) => d.take({ ...at, thread: req.thread })),
      ),
      inboxStatus: serviceHandler(
        ON_THREAD({ status: z.enum(INBOX_STATUSES) }),
        (ctx: restate.Context, req: ThreadRequest & { status: InboxStatus }) =>
          inbox(ctx, req, (d, at) => d.status({ ...at, thread: req.thread, status: req.status })),
      ),
      inboxSnooze: serviceHandler(
        ON_THREAD({
          until: z.string().nullish().describe("When it comes back, ISO; empty wakes it"),
        }),
        (ctx: restate.Context, req: ThreadRequest & { until?: string | null }) =>
          inbox(ctx, req, (d, at) =>
            d.snooze({ ...at, thread: req.thread, until: req.until ?? null }),
          ),
      ),
      /** A yes on an asked reply: sent on its channel, by someone the approver setting allows. */
      inboxApprove: serviceHandler(
        ASKED,
        (ctx: restate.Context, req: PortalRequest & { id: number }) =>
          inbox(ctx, req, (d, at) => d.approve({ ...at, id: req.id })),
      ),
      inboxDrop: serviceHandler(
        ASKED,
        (ctx: restate.Context, req: PortalRequest & { id: number }) =>
          inbox(ctx, req, (d, at) => d.drop({ ...at, id: req.id })),
      ),
      /** A client draft's stage and target. Its posts carry no Wren link. */
      draftFunnel: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            draftId: z.union([z.string(), z.number()]).describe("The draft's id"),
            stage: z.string().nullish(),
            to: z.string().nullish(),
            video: z.string().nullish(),
            linked: z.union([z.string(), z.boolean()]).nullish(),
          }),
        },
        (ctx: restate.Context, req: FunnelConsoleRequest) =>
          answer(async () => {
            const key = await ctx.run("check", () => answer(() => api.deciding(req)));
            const { stage, to, video, linked } = req;
            return desk(() =>
              deskOf(ctx, key).funnel({
                draftId: String(req.draftId),
                ...({ stage, to, video, linked } as Omit<FunnelRequest, "draftId">),
                viewer: req.viewer,
              }),
            );
          }),
      ),
      /**
       * Promote the client's YouTube post: one draft per platform its logins post on, pointing at
       * the video, each waiting in its To approve. Checked here, then started, not awaited (a
       * model call per platform). Nothing posts.
       */
      promote: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            draftId: z.union([z.string(), z.number()]).describe("The YouTube post's draft id"),
            pieces: z
              .array(z.enum(PROMO_PIECES))
              .nullish()
              .describe("posts, thread, carousel; empty = posts"),
          }),
        },
        (ctx: restate.Context, req: PromoteRequest) =>
          answer(async () => {
            const go = await ctx.run("check", () => answer(() => api.promoting(req)));
            ctx.objectSendClient<ContentDesk>({ name: "ContentDesk" }, go.key).promote({
              draftId: go.draftId,
              platforms: go.platforms,
              ...(req.pieces?.length ? { pieces: req.pieces } : {}),
              viewer: req.viewer,
            });
            return { started: true, platforms: go.platforms };
          }),
      ),
      /** A client carousel's slides, saved on both its drafts, and drawn on `draw`. */
      draftSlides: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            draftId: z.union([z.string(), z.number()]).describe("The draft's id"),
            slides: z
              .array(z.looseObject({ title: z.string(), lines: z.array(z.string()) }))
              .nullish(),
            draw: z.boolean().nullish(),
          }),
        },
        (ctx: restate.Context, req: SlidesRequest) =>
          answer(async () => {
            const key = await ctx.run("check", () => answer(() => api.deciding(req)));
            return desk(() =>
              deskOf(ctx, key).slides({
                draftId: String(req.draftId),
                ...(req.slides ? { slides: req.slides } : {}),
                ...(req.draw ? { draw: true } : {}),
                viewer: req.viewer,
              }),
            );
          }),
      ),
      /** A file on a client draft's field (thumbnail, subtitles, cover). */
      draftAttach: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            draftId: z.union([z.string(), z.number()]).describe("The draft's id"),
            field: z.string(),
            name: z.string(),
            data: z.string().describe("The bytes, base64"),
          }),
        },
        (ctx: restate.Context, req: AttachRequest) =>
          answer(async () => {
            const key = await ctx.run("check", () => answer(() => api.deciding(req)));
            return desk(() =>
              deskOf(ctx, key).attach({
                draftId: String(req.draftId),
                field: req.field,
                name: req.name,
                data: req.data,
                viewer: req.viewer,
              }),
            );
          }),
      ),
    },
  });
}

export type MarketingConsoleService = ReturnType<typeof makeMarketingConsole>;
