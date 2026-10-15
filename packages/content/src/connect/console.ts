/**
 * SocialAccess (designs/2026-10-07-client-social.md): Account → Social. A client's people see
 * each platform's state (Not connected, Waiting on review, Connected, Broken), connect an account
 * with one sign-in, check it and turn it off. `SocialCallback/land` is where each platform sends
 * the person back: public, its authority the one-time state it carries.
 */
import * as restate from "@restatedev/restate-sdk";
import { WREN } from "@wren/core/access";
import type { Platform } from "@wren/core/content";
import type { SitesHost } from "@wren/core/content/restate";
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
import { accountsOf, checkNow, type Setup, type SetupEmit, startSetup } from "@wren/core/setup";
import { spineEmit } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { z } from "zod";
import type { SocialAccessApi } from "./access.js";
import { SOCIAL_ACCESS_APPS, SOCIAL_ACCESS_ROUTES } from "./console-routes.js";
import {
  checkOwn,
  type OwnCheck,
  type OwnSites,
  type OwnSwitches,
  type OwnView,
  ownChannels,
  ownView,
  readOwnRows,
  restateOwnSites,
} from "./own.js";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "./platforms.js";
import { SOCIAL_SETUP } from "./setups.js";

export interface SocialConsoleDeps {
  main: Db;
  access: SocialAccessApi;
  /** The worker's copy of the setup; the module's own when absent. */
  setup?: Setup;
  now?: () => Date;
  /**
   * Wren's own channels, for the team on Wren's Account → Social: config as the worker reads it,
   * every platform Wren could post to, and where the Check reaches autobrowse (`sitesHost`). The
   * preview passes `sites`, a stand-in, instead of a host.
   */
  own?: { switches: OwnSwitches; known: readonly Platform[]; box?: SitesHost; sites?: OwnSites };
}

const by = (req: PortalRequest) => (req.viewer as SignedViewer).email ?? "unknown";

/** The handlers as plain calls; moves answer the events to emit. */
export function socialConsoleApi(deps: SocialConsoleDeps) {
  const { main, access } = deps;
  const now = () => deps.now?.() ?? new Date();
  const setup = deps.setup ?? SOCIAL_SETUP;
  /** The client the viewer may open; Wren's own accounts are its channels, never here. */
  const owner = async (req: PortalRequest) => {
    if (req.client === WREN) throw new PortalRefusal("Wren's own accounts aren't here", 409);
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
  const ownOf = async (switches: OwnSwitches, known: readonly Platform[]) => {
    const channels = ownChannels(switches);
    const rows = await readOwnRows(
      main,
      channels.map((c) => c.platform),
    );
    return ownView(channels, rows, known);
  };
  const mine = async (client: string, id: number) => {
    const c = await access.connection(Number(id));
    if (!c || c.client !== client) throw new PortalRefusal("no such account", 404);
    return c;
  };

  return {
    /** Every platform with its state, its accounts and the next step. */
    async social(req: PortalRequest) {
      if (req.client === WREN) {
        // Wren's own channels are the team's, for debugging: a client's people never see them.
        const team = teamCan(req, "read", WREN) && deps.own !== undefined;
        const own: OwnView | null =
          team && deps.own ? await ownOf(deps.own.switches, deps.own.known) : null;
        return {
          owner: { id: null, name: "Wren" },
          wren: true as const,
          mayAct: team && teamCan(req, "act", WREN),
          own,
        };
      }
      const c = await owner(req);
      const v = await access.view(c.id);
      return {
        owner: { id: c.id, name: c.name },
        wren: false as const,
        mayAct: await mayAct(req, c.id),
        ...v,
      };
    },

    /** Where the person signs in as the account. */
    async connect(req: PortalRequest & { platform: SocialPlatform }): Promise<{ url: string }> {
      const c = await writer(req);
      const url = await access.connect({ client: c.id, platform: req.platform, by: by(req) });
      return { url };
    },

    /** Check a connection now. Its setup starts over when it isn't on its way. */
    async check(req: PortalRequest & { id: number }): Promise<{ emits: SetupEmit[] }> {
      const c = await writer(req);
      const conn = await mine(c.id, req.id);
      const a = (await accountsOf(main, c.id)).find((x) => x.id === conn.accountId);
      if (!a) throw new PortalRefusal("no such account", 404);
      const run = a.runs.find((r) => r.setup === setup.id);
      if (!run || run.state === "done" || run.state === "lost")
        return {
          emits: [await startSetup(main, setup, { accountId: a.id, by: by(req), now: now() })],
        };
      const emit = await checkNow(main, setup, { accountId: a.id, now: now() });
      return { emits: emit ? [emit] : [] };
    },

    /**
     * Wren's own channel, checked now: autobrowse's site check through `sites`/`desk` (status,
     * one who-am-I read, a dry renew). Team only. `sites` is the invocation's; the deps' otherwise.
     */
    async ownCheck(
      req: PortalRequest & { platform: string; requestId?: string },
      sites?: OwnSites,
    ): Promise<OwnCheck> {
      if (req.client !== WREN)
        throw new PortalRefusal("only Wren's own channels are checked here", 409);
      if (isDemo(req.viewer) || !teamCan(req, "act", WREN))
        throw new PortalRefusal("your role can't do that", 403);
      if (!deps.own) throw new PortalRefusal("Wren's channels aren't wired here", 503);
      const c = ownChannels(deps.own.switches).find((x) => x.platform === req.platform);
      if (!c) throw new PortalRefusal(`Wren doesn't post to ${req.platform}`, 404);
      const via = sites ?? deps.own.sites;
      if (!via) throw new PortalRefusal("autobrowse can't be reached from here", 503);
      return checkOwn(via, c);
    },

    /** Off: its token deleted. Nothing posts or reads as it again until it's connected again. */
    async disconnect(req: PortalRequest & { id: number }): Promise<{ ok: boolean }> {
      const c = await writer(req);
      await mine(c.id, req.id);
      return {
        ok: await access.disconnect({ client: c.id, id: req.id, by: by(req) }),
      };
    },
  };
}

const ID = z.number().int().positive().describe("The connected account's id");

export function makeSocialAccess(deps: SocialConsoleDeps) {
  const api = socialConsoleApi(deps);
  const read =
    <R extends PortalRequest, T>(fn: (req: R) => Promise<T>) =>
    (_: restate.Context, req: R) =>
      answer(() => fn(req));
  const write =
    <R extends PortalRequest, T>(name: string, fn: (req: R) => Promise<T>) =>
    (ctx: restate.Context, req: R) =>
      answer(() => ctx.run(name, () => answer(() => fn(req))));
  const move =
    <R extends PortalRequest, T extends { emits: SetupEmit[] }>(
      name: string,
      fn: (req: R) => Promise<T>,
    ) =>
    async (ctx: restate.Context, req: R) => {
      const out = await answer(() => ctx.run(name, () => answer(() => fn(req))));
      for (const e of out.emits) spineEmit(ctx, e);
      const { emits: _, ...rest } = out;
      return { ok: true, ...rest };
    };
  return portalService({
    name: "SocialAccess",
    main: deps.main,
    routes: SOCIAL_ACCESS_ROUTES,
    apps: SOCIAL_ACCESS_APPS,
    unnamed: "first",
    handlers: {
      social: serviceHandler({ input: noRawKeys(z.looseObject(PORTAL_FIELDS)) }, read(api.social)),
      connect: serviceHandler(
        {
          input: noRawKeys(
            z.looseObject({
              ...PORTAL_FIELDS,
              platform: z.enum(SOCIAL_PLATFORMS).describe("facebook, instagram, linkedin, x"),
            }),
          ),
        },
        write("connect", api.connect),
      ),
      check: serviceHandler(
        { input: noRawKeys(z.looseObject({ ...PORTAL_FIELDS, id: ID })) },
        move("check", api.check),
      ),
      disconnect: serviceHandler(
        { input: noRawKeys(z.looseObject({ ...PORTAL_FIELDS, id: ID })) },
        write("disconnect", api.disconnect),
      ),
      // Its calls are durable calls to autobrowse, each capped; nothing here posts or writes.
      ownCheck: serviceHandler(
        {
          input: noRawKeys(
            z.looseObject({
              ...PORTAL_FIELDS,
              platform: z
                .string()
                .min(1)
                .max(32)
                .describe("One of Wren's own channels: x, linkedin"),
              requestId: z.string().max(100).optional().describe("The press's id"),
            }),
          ),
        },
        (ctx: restate.Context, req: PortalRequest & { platform: string; requestId?: string }) =>
          answer(() =>
            api.ownCheck(req, deps.own?.box ? restateOwnSites(ctx, deps.own.box) : undefined),
          ),
      ),
    },
  });
}

/**
 * What a platform sends back, as the portal's Worker passes it on. Its code and state look like
 * keys and are one-time, so this one input skips `noRawKeys`, as MailCallback's does.
 */
export const SOCIAL_LANDING = z.looseObject({
  platform: z.enum(SOCIAL_PLATFORMS),
  state: z.string().max(128),
  code: z.string().max(4096).nullish(),
  error: z.string().max(200).nullish(),
});

/**
 * The callback: the state used once, the token kept, and the account's setup started or checked.
 * Answers only what the landing page says.
 */
export function makeSocialCallback(deps: SocialConsoleDeps) {
  const setup = deps.setup ?? SOCIAL_SETUP;
  return restate.service({
    name: "SocialCallback",
    handlers: {
      land: serviceHandler(
        { input: SOCIAL_LANDING },
        async (ctx: restate.Context, q: z.infer<typeof SOCIAL_LANDING>) => {
          const out = await ctx.run("land", async () => {
            const r = await deps.access.land(q);
            const emits: SetupEmit[] = [];
            for (const id of r.check) {
              const [a] = r.client
                ? (await accountsOf(deps.main, r.client)).filter((x) => x.id === id)
                : [];
              if (!a) continue;
              const run = a.runs.find((x) => x.setup === setup.id);
              const e =
                run && run.state !== "done" && run.state !== "lost"
                  ? await checkNow(deps.main, setup, { accountId: a.id })
                  : await startSetup(deps.main, setup, { accountId: a.id, by: "callback" });
              if (e) emits.push(e);
            }
            return { ok: r.ok, said: r.said, emits };
          });
          for (const e of out.emits) spineEmit(ctx, e);
          return { ok: out.ok, said: out.said };
        },
      ),
    },
  });
}

/** Account → Social's page, as `SocialAccess/social` answers it. */
export type SocialPageView = Awaited<ReturnType<ReturnType<typeof socialConsoleApi>["social"]>>;
