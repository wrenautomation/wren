/**
 * The content channels as one Restate service, `Content`: publish and the
 * reads, keyed by platform. Every site call underneath is a call to
 * autobrowse's `sites` service on the same Restate, so it is journaled,
 * queues while the box is down, and a retry of `publish` never posts twice
 * (the worker runs a write once). No port on the box is ever reached from
 * here.
 */
import * as restate from "@restatedev/restate-sdk";
import {
  SiteCallError,
  type SiteClient,
  type SiteMethod,
  type SiteStatus,
  viaOf,
} from "./autobrowse.js";
import type { ContentChannel, ListQuery, Platform, Post } from "./index.js";

export type Channels = Partial<Record<Platform, ContentChannel>>;

export const SITES = { name: "sites" } as const;

/** The `sites` service's handlers as autobrowse serves them; no import from that repo. */
type SitesService = {
  status: (ctx: restate.Context, req: { site: string }) => Promise<SiteStatus>;
  call: (
    ctx: restate.Context,
    req: { site: string; method: SiteMethod; path: string; input?: Record<string, unknown> },
  ) => Promise<unknown>;
  setup: (
    ctx: restate.Context,
    req: { site: string; step: string },
  ) => Promise<{ made: readonly string[] }>;
};

/** A terminal error from `sites` carries the site's own status code; surface it as a SiteCallError. */
function siteCallErrorFrom(err: unknown, site: string, method: string, path: string): Error {
  if (err instanceof restate.TerminalError)
    return new SiteCallError(site, method, path, err.code ?? 500, err.message);
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Wake the machine `sites` runs on: start it if stopped, no-op if running.
 * Idempotent, so a retried invocation may wake twice. The box stops itself
 * again once idle.
 */
export type Wake = () => Promise<"started" | "running">;

/**
 * autobrowse's site APIs through the invocation's context: each call is a
 * durable step of this invocation. With a `wake`, the first call of the
 * invocation starts the box first (one journaled step); Restate then holds
 * the call until the worker is back on the tunnel.
 */
export function restateSites(ctx: restate.Context, wake?: Wake): SiteClient {
  const client = ctx.serviceClient<SitesService>(SITES);
  const statuses = new Map<string, Promise<SiteStatus>>();
  let woken: Promise<unknown> | null = null;
  const awake = () => {
    if (!wake) return Promise.resolve();
    woken ??= ctx.run("wake autobrowse", wake);
    return woken;
  };
  return {
    async call(site, method, path, input = {}) {
      await awake();
      try {
        return (await client.call({ site, method, path, input })) as never;
      } catch (err) {
        throw siteCallErrorFrom(err, site, method, path);
      }
    },
    async via(site, method, path) {
      await awake();
      const p = statuses.get(site) ?? client.status({ site });
      statuses.set(site, p);
      return viaOf(await p, method, path);
    },
  };
}

/** Build the channels for one invocation from its context (the `sites` calls need it). */
export type ChannelsFor = (ctx: restate.Context) => Channels;

export function makeContent(channelsFor: ChannelsFor) {
  const pick = (ctx: restate.Context, platform: Platform): ContentChannel => {
    const ch = channelsFor(ctx)[platform];
    if (!ch)
      throw new restate.TerminalError(`no ${platform} channel configured`, { errorCode: 404 });
    return ch;
  };
  return restate.service({
    name: "Content",
    handlers: {
      platforms: async (ctx: restate.Context): Promise<Platform[]> => {
        const channels = channelsFor(ctx);
        return (Object.keys(channels) as Platform[]).filter((p) => channels[p]);
      },
      publish: async (ctx: restate.Context, req: { platform: Platform; post: Post }) =>
        pick(ctx, req.platform).publish(req.post),
      list: async (ctx: restate.Context, req: { platform: Platform; q?: ListQuery }) =>
        pick(ctx, req.platform).list(req.q ?? {}),
      metrics: async (ctx: restate.Context, req: { platform: Platform; id: string }) =>
        pick(ctx, req.platform).metrics(req.id),
      comments: async (
        ctx: restate.Context,
        req: { platform: Platform; id: string; q?: ListQuery },
      ) => pick(ctx, req.platform).comments(req.id, req.q ?? {}),
      reply: async (
        ctx: restate.Context,
        req: { platform: Platform; commentId: string; text: string },
      ) => {
        const ch = pick(ctx, req.platform);
        if (!ch.reply)
          throw new restate.TerminalError(`${req.platform} cannot reply here`, { errorCode: 501 });
        await ch.reply(req.commentId, req.text);
      },
    },
  });
}
export type Content = ReturnType<typeof makeContent>;
