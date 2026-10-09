/**
 * Connectors on Restate (designs/2026-10-09-connectors.md): `Connectors` is Account →
 * Connectors, `ConnectorCallback/land` where each app sends the person back, and
 * `ConnectorSync/<link>` the hourly read, one at a time per link so a rotating refresh token
 * never races itself.
 */
import * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import { noRawKeys } from "@wren/core/key-refs";
import {
  answer,
  canAt,
  isDemo,
  PortalRefusal,
  type PortalRequest,
  pickClient,
  portalService,
  type SignedViewer,
  teamCan,
} from "@wren/core/portal";
import { PORTAL_FIELDS, serviceHandler } from "@wren/core/restate";
import type { FireTriggers } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { z } from "zod";
import { CONNECTOR_APPS, type ConnectorApp } from "./apps.js";
import { type ConnectorAccess, ConnectorRefusal } from "./connectors.js";
import { CONNECTORS_APPS, CONNECTORS_ROUTES } from "./console-routes.js";
import { type SyncDeps, syncLink } from "./sync.js";

/** A link's reads: hourly, sooner when a run stopped at its cap. */
export const SYNC_EVERY_MS = 60 * 60_000;
export const SYNC_MORE_MS = 5 * 60_000;

export interface ConnectorsDeps {
  main: Db;
  access: ConnectorAccess;
}

const by = (req: PortalRequest) => (req.viewer as SignedViewer).email ?? "unknown";

const refusal = (err: unknown): never => {
  if (err instanceof PortalRefusal) throw err;
  if (err instanceof ConnectorRefusal)
    throw new PortalRefusal(err.message, err.status === 404 ? 404 : 409);
  throw err;
};

type ConnectorSyncObject = ReturnType<typeof makeConnectorSync>;
const SYNC = { name: "ConnectorSync" } as unknown as ConnectorSyncObject;

/** Start a link's reads now; any older chain of hourly runs stops at its next turn. */
export const startSync = (ctx: restate.Context, link: number) =>
  ctx.objectSendClient(SYNC, String(link)).run({});

/** The handlers as plain calls. */
export function connectorsConsoleApi(deps: ConnectorsDeps) {
  const { main, access } = deps;
  const owner = async (req: PortalRequest) => {
    if (req.client === WREN) throw new PortalRefusal("Connect apps for a client", 409);
    return pickClient(main, req);
  };
  const mayAct = async (req: PortalRequest, client: string) =>
    !isDemo(req.viewer) &&
    (teamCan(req, "act", client) || (await canAt(main, req, "act", { client, app: "account" })));
  const writer = async (req: PortalRequest) => {
    if (isDemo(req.viewer)) throw new PortalRefusal("the demo is read-only", 403);
    const c = await owner(req);
    if (!(await mayAct(req, c.id))) throw new PortalRefusal("your role can't do that", 403);
    return c;
  };
  const mine = async (client: string, id: number) => {
    const l = await access.link(Number(id));
    if (!l || l.client !== client) throw new PortalRefusal("no such connection", 404);
    return l;
  };
  return {
    async connectors(req: PortalRequest) {
      if (req.client === WREN)
        return { owner: { id: null, name: "Wren" }, wren: true as const, mayAct: false };
      const c = await owner(req);
      return {
        owner: { id: c.id, name: c.name },
        wren: false as const,
        mayAct: await mayAct(req, c.id),
        ...(await access.view(c.id)),
      };
    },
    async connect(req: PortalRequest & { app: ConnectorApp }): Promise<{ url: string }> {
      const c = await writer(req);
      return {
        url: await access.connect({ client: c.id, app: req.app, by: by(req) }).catch(refusal),
      };
    },
    /** The link to read now, checked as the viewer's. */
    async syncNow(req: PortalRequest & { id: number }): Promise<{ link: number }> {
      const c = await writer(req);
      const l = await mine(c.id, req.id);
      if (l.state !== "connected") throw new PortalRefusal(l.why ?? "Connect it again first", 409);
      return { link: l.id };
    },
    async disconnect(req: PortalRequest & { id: number }): Promise<{ ok: boolean }> {
      const c = await writer(req);
      await mine(c.id, req.id);
      return {
        ok: await access.disconnect({ client: c.id, id: req.id, by: by(req) }).catch(refusal),
      };
    },
  };
}

/** Account → Connectors' page, as `Connectors/connectors` answers it. */
export type ConnectorsPageView = Awaited<
  ReturnType<ReturnType<typeof connectorsConsoleApi>["connectors"]>
>;

const ID = z.number().int().positive().describe("The connection's id");

export function makeConnectors(deps: ConnectorsDeps) {
  const api = connectorsConsoleApi(deps);
  const read =
    <R extends PortalRequest, T>(fn: (req: R) => Promise<T>) =>
    (_: restate.Context, req: R) =>
      answer(() => fn(req));
  const write =
    <R extends PortalRequest, T>(name: string, fn: (req: R) => Promise<T>) =>
    (ctx: restate.Context, req: R) =>
      answer(() => ctx.run(name, () => answer(() => fn(req))));
  return portalService({
    name: "Connectors",
    main: deps.main,
    routes: CONNECTORS_ROUTES,
    apps: CONNECTORS_APPS,
    unnamed: "first",
    handlers: {
      connectors: serviceHandler(
        { input: noRawKeys(z.looseObject(PORTAL_FIELDS)) },
        read(api.connectors),
      ),
      connect: serviceHandler(
        {
          input: noRawKeys(
            z.looseObject({
              ...PORTAL_FIELDS,
              app: z.enum(CONNECTOR_APPS).describe("hubspot, quickbooks or jobber"),
            }),
          ),
        },
        write("connect", api.connect),
      ),
      syncNow: serviceHandler(
        { input: noRawKeys(z.looseObject({ ...PORTAL_FIELDS, id: ID })) },
        async (ctx: restate.Context, req: PortalRequest & { id: number }) => {
          const out = await answer(() => ctx.run("check", () => answer(() => api.syncNow(req))));
          startSync(ctx, out.link);
          return { ok: true };
        },
      ),
      disconnect: serviceHandler(
        { input: noRawKeys(z.looseObject({ ...PORTAL_FIELDS, id: ID })) },
        write("disconnect", api.disconnect),
      ),
    },
  });
}

/**
 * What an app sends back, as the portal's Worker passes it on. Its code and state look like keys
 * and are one-time, so this one input skips `noRawKeys`, as SocialCallback's does.
 */
export const CONNECTOR_LANDING = z.looseObject({
  app: z.enum(CONNECTOR_APPS),
  state: z.string().max(128),
  code: z.string().max(4096).nullish(),
  error: z.string().max(200).nullish(),
  realmId: z.string().max(64).nullish(),
});

/** The callback: the state spent once, the link kept, its first read started. */
export function makeConnectorCallback(deps: ConnectorsDeps) {
  return restate.service({
    name: "ConnectorCallback",
    handlers: {
      land: serviceHandler(
        { input: CONNECTOR_LANDING },
        async (ctx: restate.Context, q: z.infer<typeof CONNECTOR_LANDING>) => {
          const r = await ctx.run("land", () => deps.access.land(q));
          if (r.link) startSync(ctx, r.link);
          return { ok: r.ok, said: r.said };
        },
      ),
    },
  });
}

export interface ConnectorSyncDeps extends SyncDeps {
  fire?: FireTriggers;
}

/**
 * One link's reads, keyed by its id. Each run starts a new chain and sends its next turn with
 * that chain's id; a turn from an older chain (a Sync now started a new one) does nothing.
 */
export function makeConnectorSync(deps: ConnectorSyncDeps) {
  return restate.object({
    name: "ConnectorSync",
    handlers: {
      run: restate.handlers.object.exclusive(
        { ingressPrivate: true },
        async (
          ctx: restate.ObjectContext,
          req: { chain?: string },
        ): Promise<{ state: string; people: number; fired: number }> => {
          if (req.chain && req.chain !== (await ctx.get<string>("chain")))
            return { state: "stale", people: 0, fired: 0 };
          const id = Number(ctx.key);
          const now = new Date(await ctx.date.now());
          const out = await ctx.run("sync", () => syncLink({ ...deps, now: () => now }, id));
          if (deps.fire) for (const f of out.fired) deps.fire(ctx, f);
          if (out.state !== "connected") {
            ctx.clear("chain");
            return { state: out.state, people: 0, fired: 0 };
          }
          const chain = ctx.rand.uuidv4();
          ctx.set("chain", chain);
          ctx
            .objectSendClient(SYNC, ctx.key)
            .run(
              { chain },
              restate.rpc.sendOpts({ delay: out.more ? SYNC_MORE_MS : SYNC_EVERY_MS }),
            );
          return { state: out.state, people: out.people, fired: out.fired.length };
        },
      ),
    },
  });
}
