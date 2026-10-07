/**
 * PaymentsConsole: the portal's Payments page and the Texts thread action
 * (designs/2026-10-07-forms-and-pay.md, "Portal").
 *
 * - `records*`: a client's pay links, on the main database, kept to that client.
 * - `create`, `fromThread`: a new link. Whoever may approve for the client sends it now;
 *   anyone else's waits in To approve.
 * - `approve`, `decline`: To approve's yes and no, checked against the client's approver.
 * - `connect`: the client's Stripe key, then Wren's webhook on their account with it. A key
 *   that can't add webhooks leaves a signing secret to paste.
 * - `status`: what the page's Stripe panel shows.
 *
 * A key is never read back, and no card ever reaches us.
 */
import type * as restate from "@restatedev/restate-sdk";
import { toPhoneE164 } from "@wren/channel-sms";
import { smsContacts } from "@wren/channel-sms/schema";
import { mayApprove } from "@wren/core/access";
import { type Client, findClient } from "@wren/core/clients";
import {
  accessOf,
  answer,
  canAt,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  pickForWrite,
  portalService,
  type SignedViewer,
  whoIs,
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
import { addAccount } from "@wren/core/setup";
import { vendorModes } from "@wren/core/vendor-schema";
import { setOwnKey } from "@wren/core/vendors";
import { snapshot } from "@wren/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { PAYMENTS_CONSOLE_APPS, PAYMENTS_CONSOLE_ROUTES } from "./console-routes.js";
import { linkRecordFor } from "./records.js";
import type { PayChannel, PayLink } from "./schema.js";
import { payLinks } from "./schema.js";
import {
  PAYMENTS,
  type PaymentsDeps,
  type PaymentsService,
  secretPath,
  webhookUrl,
} from "./service.js";
import {
  approveLinks,
  centsOf,
  createLink,
  declineLinks,
  linkIdOf,
  PayRefusal,
  payAccountOf,
  savePayAccount,
  UUID,
} from "./store.js";
import { isSigningSecret, keyMode, StripeError, stripeApi } from "./stripe.js";

export type PaymentsConsoleDeps = Pick<
  PaymentsDeps,
  "main" | "open" | "keys" | "env" | "fetch" | "portal" | "stripeBase"
>;

export interface CreateRequest extends PortalRequest {
  /** "sms" or "email"; a phone or an email decides when left out. */
  channel?: string | null;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  amount: string | number;
  description: string;
  quantity?: string | number | null;
}
export interface FromThreadRequest extends PortalRequest {
  /** The threads, as the Texts record shows their ids. */
  ids: (string | number)[];
  amount: string | number;
  description: string;
  quantity?: string | number | null;
}
export interface IdsRequest extends PortalRequest {
  ids: string[];
}
export interface ConnectRequest extends PortalRequest {
  key?: string | null;
  /** A signing secret from Stripe's dashboard, when the key couldn't add the webhook. */
  secret?: string | null;
}

const by = (req: PortalRequest) => (req.viewer as SignedViewer).email;
const NOT_YOURS = { wren: "Wren's team approves these", client: "the client approves these" };

function refusal(err: unknown): never {
  if (err instanceof PayRefusal) throw new PortalRefusal(err.message, err.status);
  throw err;
}
const quantityOf = (q: unknown) => {
  if (q === undefined || q === null || q === "") return 1;
  const n = Number(q);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new PortalRefusal("quantity: 1 to 100", 400);
  return n;
};

/** The handlers as plain calls: the service wraps them, tests and the preview call them. */
export function paymentsConsoleApi(deps: PaymentsConsoleDeps) {
  const { main, open } = deps;
  const read = async <T>(req: PortalRequest, use: (api: RecordsApi) => Promise<T>) => {
    const client = await pickClient(main, req);
    return snapshot(main, (tx) =>
      use(
        serveRecords(
          [linkRecordFor(client.id)],
          tx,
          undefined,
          fenceFor(req, client.id),
          meOf(req),
        ),
      ),
    );
  };
  /** May this viewer say yes for the client: its `approver` decides. */
  const approves = async (req: PortalRequest, client: Client) => {
    const v = req.viewer;
    const who =
      !isDemo(v) && !v.access && !v.operator ? await whoIs(main, v, client.id) : accessOf(req);
    return mayApprove(who, client.id, client.approver);
  };
  const may = async (req: PortalRequest, client: Client) => {
    if (!(await canAt(main, req, "act", { client: client.id, app: "payments" })))
      throw new PortalRefusal("your role can't do that here", 403);
  };

  return {
    recordsTypes: async (req: PortalRequest) => {
      const client = await pickClient(main, req);
      const fence = fenceFor(req, client.id);
      return [linkRecordFor(client.id)]
        .filter((t) => !fence || opens(t, fence(t)))
        .map((t) => metaOf(t, false));
    },
    recordsList: (req: PortalRequest & ListAsk) => read(req, (r) => r.list(req)),
    recordsGet: (req: PortalRequest & GetAsk) => read(req, (r) => r.get(req)),
    recordsExport: (req: PortalRequest & ExportAsk) => read(req, (r) => r.export(req)),
    recordsStats: (req: PortalRequest & StatsAsk) => read(req, (r) => r.stats(req)),

    /** The Stripe panel: connected or not, the webhook, test or live, and who may approve. */
    status: async (req: PortalRequest) => {
      const client = await pickClient(main, req);
      const [m] = await main
        .select({ mode: vendorModes.mode, keyName: vendorModes.keyName })
        .from(vendorModes)
        .where(and(eq(vendorModes.client, client.id), eq(vendorModes.vendor, "stripe")));
      const acct = await payAccountOf(main, client.id);
      return {
        connected: m?.mode === "own" && !!m.keyName,
        live: acct?.live ?? null,
        webhook: acct?.secretName ? (acct.how ?? "pasted") : null,
        url: webhookUrl(deps.portal, client.id),
        keyStore: deps.keys !== null,
        managed: "In development",
        approves: await approves(req, client),
      };
    },

    /** A new link from the Payments page: a phone with a thread, or an email. */
    create: async (req: CreateRequest, now: Date) => {
      const { client, viewer } = await pickForWrite(main, req);
      const phone = typeof req.phone === "string" && req.phone.trim() ? req.phone : null;
      const email = typeof req.email === "string" && req.email.trim() ? req.email : null;
      const channel: PayChannel =
        req.channel === "sms" || req.channel === "email" ? req.channel : phone ? "sms" : "email";
      let contact: number | null = null;
      let name = typeof req.name === "string" ? req.name : null;
      if (channel === "sms") {
        const e164 = phone ? toPhoneE164(phone) : null;
        if (!e164) throw new PortalRefusal("type a phone number, or send it by email", 400);
        const [c] = await open(client)
          .select({ id: smsContacts.id, name: smsContacts.name })
          .from(smsContacts)
          .where(eq(smsContacts.e164, e164))
          .limit(1);
        if (!c)
          throw new PortalRefusal("no texting thread with that number: start from Texts", 404);
        contact = c.id;
        name = name || c.name;
      }
      const link = await createLink(main, {
        client: client.id,
        channel,
        contact,
        email,
        name,
        description: String(req.description ?? ""),
        cents: (() => {
          try {
            return centsOf(req.amount);
          } catch (e) {
            return refusal(e);
          }
        })(),
        quantity: quantityOf(req.quantity),
        by: viewer.email,
        approved: await approves(req, client),
        now,
      }).catch(refusal);
      return { links: [link] };
    },

    /** One link per thread picked in Texts, each to that thread's number. */
    fromThread: async (req: FromThreadRequest, now: Date) => {
      const { client, viewer } = await pickForWrite(main, req);
      const ids = (Array.isArray(req.ids) ? req.ids : [])
        .map(Number)
        .filter((n) => Number.isSafeInteger(n) && n > 0);
      if (!ids.length || ids.length > 50) throw new PortalRefusal("pick a thread (up to 50)", 400);
      let cents: number;
      try {
        cents = centsOf(req.amount);
      } catch (e) {
        return refusal(e);
      }
      const quantity = quantityOf(req.quantity);
      const threads = await open(client)
        .select({ id: smsContacts.id, name: smsContacts.name, email: smsContacts.email })
        .from(smsContacts)
        .where(inArray(smsContacts.id, ids));
      if (!threads.length) throw new PortalRefusal("no such thread", 404);
      const approved = await approves(req, client);
      const links: PayLink[] = [];
      for (const t of threads)
        links.push(
          await createLink(main, {
            client: client.id,
            channel: "sms",
            contact: t.id,
            email: t.email,
            name: t.name,
            description: String(req.description ?? ""),
            cents,
            quantity,
            by: viewer.email,
            approved,
            now,
          }).catch(refusal),
        );
      return { links };
    },

    /** To approve's yes: `pay:<id>` or bare ids, each checked against its own client. */
    approve: async (req: IdsRequest, now: Date) => {
      const ids = await decidable(req);
      return { links: await approveLinks(main, ids, by(req), now) };
    },
    decline: async (req: IdsRequest, now: Date) => {
      const ids = await decidable(req);
      return { done: await declineLinks(main, ids, by(req), now) };
    },

    /**
     * The client's key, saved; then our webhook on their account with it. A pasted secret
     * stands in for the webhook when the key can't add one. Approvers only: it's their money.
     */
    connect: async (req: ConnectRequest, now: Date) => {
      const { client, viewer } = await pickForWrite(main, req);
      if (!(await approves(req, client)))
        throw new PortalRefusal(NOT_YOURS[client.approver === "client" ? "client" : "wren"], 403);
      if (!deps.keys) throw new PortalRefusal("Saving a Stripe key is in development here", 503);
      const keys = deps.keys;
      const key = typeof req.key === "string" ? req.key.trim() : "";
      const secret = typeof req.secret === "string" ? req.secret.trim() : "";
      if (!key && !secret) throw new PortalRefusal("paste a Stripe key or a signing secret", 400);
      if (secret) {
        if (!isSigningSecret(secret))
          throw new PortalRefusal("a signing secret starts with whsec_", 400);
        const secretName = secretPath(deps.env, client.id);
        await keys.put(secretName, secret);
        await savePayAccount(main, {
          client: client.id,
          secretName,
          how: "pasted",
          by: viewer.email,
        });
        if (!key) return { connected: true, webhook: "pasted" as const };
      }
      const mode = keyMode(key);
      if (!mode)
        throw new PortalRefusal("a Stripe key starts with sk_ or rk_, then live_ or test_", 400);
      await setOwnKey(main, keys, {
        client: client.id,
        vendor: "stripe",
        value: key,
        env: deps.env,
        by: viewer.email,
      }).catch((e: Error) => {
        throw new PortalRefusal(e.message, 400);
      });
      await addAccount(main, {
        client: client.id,
        site: "stripe",
        ref: mode === "live" ? "Stripe" : "Stripe (test mode)",
        by: viewer.email,
      });
      await savePayAccount(main, { client: client.id, live: mode === "live", by: viewer.email });
      if (secret) return { connected: true, webhook: "pasted" as const };
      const url = webhookUrl(deps.portal, client.id);
      try {
        const hook = await stripeApi(key, deps.fetch, deps.stripeBase).registerWebhook({
          client: client.id,
          url,
          idem: `${client.id}-${now.getTime()}`,
        });
        const secretName = secretPath(deps.env, client.id);
        await keys.put(secretName, hook.secret);
        await savePayAccount(main, {
          client: client.id,
          endpoint: hook.id,
          secretName,
          how: "api",
          live: hook.livemode,
          by: viewer.email,
        });
        return { connected: true, webhook: "api" as const };
      } catch (err) {
        if (!(err instanceof StripeError)) throw err;
        return {
          connected: true,
          webhook: null,
          url,
          why: err.denied
            ? "This key can't add webhooks. In Stripe, add an endpoint at this URL for checkout.session.completed, then paste its signing secret."
            : `Stripe: ${err.message}`,
        };
      }
    },
  };

  /** The ids this viewer may decide on: every one's client checked, the act and the approver. */
  async function decidable(req: IdsRequest): Promise<string[]> {
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    const asked = (Array.isArray(req.ids) ? req.ids : []).map((x) => linkIdOf(String(x)));
    const ids = asked.filter((id) => UUID.test(id));
    if (!ids.length || ids.length > 500) throw new PortalRefusal("pick a pay link first", 400);
    const rows = await main
      .select({ id: payLinks.id, client: payLinks.client })
      .from(payLinks)
      .where(inArray(payLinks.id, ids));
    for (const owner of new Set(rows.map((r) => r.client))) {
      const client = await findClient(main, owner);
      if (!client || client.demo) throw new PortalRefusal("the demo is read-only", 403);
      await may(req, client);
      if (!(await approves(req, client)))
        throw new PortalRefusal(NOT_YOURS[client.approver === "client" ? "client" : "wren"], 403);
    }
    return rows.map((r) => r.id);
  }
}

const RECORDS = { input: z.looseObject(PORTAL_FIELDS) };
const IDS = {
  input: z.looseObject({
    ...PORTAL_FIELDS,
    ids: z.array(z.string()).describe("The pay links' ids, or To approve's pay:<id>"),
  }),
};
const MONEY = {
  amount: z.union([z.string(), z.number()]).describe("Dollars, as 49.00"),
  description: z.string().describe("What it's for: the payer sees it"),
  quantity: z.union([z.string(), z.number()]).nullish().describe("How many; 1 when left out"),
};

export function makePaymentsConsole(deps: PaymentsConsoleDeps) {
  const api = paymentsConsoleApi(deps);
  /** Approved links go to `Payments/send` once the change is journaled. */
  const sendAll = (ctx: restate.Context, links: readonly PayLink[]) => {
    for (const l of links)
      if (l.status === "sending")
        ctx.serviceSendClient<PaymentsService>(PAYMENTS).send({ id: l.id });
  };
  const now = async (ctx: restate.Context) => new Date(await ctx.date.now());
  const brief = (l: PayLink) => ({ id: l.id, status: l.status });
  return portalService({
    name: "PaymentsConsole",
    main: deps.main,
    routes: PAYMENTS_CONSOLE_ROUTES,
    apps: PAYMENTS_CONSOLE_APPS,
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
      status: serviceHandler(RECORDS, (_: restate.Context, req: PortalRequest) =>
        answer(() => api.status(req)),
      ),
      /** A pay link to a phone with a thread, or to an email. */
      create: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ...MONEY,
            channel: z.enum(["sms", "email"]).nullish().describe("Text or email"),
            phone: z.string().nullish().describe("A number with a texting thread"),
            email: z.string().nullish().describe("Where the email goes"),
            name: z.string().nullish().describe("Who it's for"),
          }),
          effect: "sends",
        },
        (ctx: restate.Context, req: CreateRequest) =>
          answer(async () => {
            const at = await now(ctx);
            const { links } = await ctx.run("create", () => answer(() => api.create(req, at)));
            sendAll(ctx, links);
            return { links: links.map(brief) };
          }),
      ),
      /** A pay link to each picked texting thread. */
      fromThread: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            ...MONEY,
            ids: z.array(z.union([z.string(), z.number()])).describe("The threads' ids"),
          }),
          effect: "sends",
        },
        (ctx: restate.Context, req: FromThreadRequest) =>
          answer(async () => {
            const at = await now(ctx);
            const { links } = await ctx.run("create", () => answer(() => api.fromThread(req, at)));
            sendAll(ctx, links);
            return { links: links.map(brief) };
          }),
      ),
      approve: serviceHandler(
        { ...IDS, effect: "sends" },
        (ctx: restate.Context, req: IdsRequest) =>
          answer(async () => {
            const at = await now(ctx);
            const { links } = await ctx.run("approve", () => answer(() => api.approve(req, at)));
            sendAll(ctx, links);
            return { done: links.map((l) => l.id) };
          }),
      ),
      decline: serviceHandler(IDS, (ctx: restate.Context, req: IdsRequest) =>
        answer(async () => {
          const at = await now(ctx);
          return ctx.run("decline", () => answer(() => api.decline(req, at)));
        }),
      ),
      /** Connect Stripe: a key (we add the webhook), a signing secret, or both. */
      connect: serviceHandler(
        {
          input: z.looseObject({
            ...PORTAL_FIELDS,
            key: z
              .string()
              .nullish()
              .describe("A Stripe secret or restricted key; never read back"),
            secret: z.string().nullish().describe("A webhook signing secret, whsec_"),
          }),
        },
        (ctx: restate.Context, req: ConnectRequest) =>
          answer(async () => {
            const at = await now(ctx);
            return ctx.run("connect", () => answer(() => api.connect(req, at)));
          }),
      ),
    },
  });
}
export type PaymentsConsoleService = ReturnType<typeof makePaymentsConsole>;
