/**
 * The content channels as one Restate service, `Content`: publish and the
 * reads, keyed by platform. Every site call underneath is a call to
 * autobrowse's `sites` service on the same Restate, so it is journaled,
 * queues while the box is down, and a retry of `publish` never posts twice
 * (the worker runs a write once). No port on the box is ever reached from
 * here.
 *
 * A request with `client` runs on that client's own logins (`ContentClients.channels`), its reads
 * through its vendor gate. A post or a reply for a client also waits on its live flag: until an
 * admin turns its posting on, the service refuses it (designs/2026-10-07-per-client-runs.md).
 */
import * as restate from "@restatedev/restate-sdk";
import { z } from "zod";
import { isVendorStop } from "../metered.js";
import { NO_INPUT, serviceHandler } from "../restate/form.js";
import {
  SiteCallError,
  type SiteClient,
  type SiteMethod,
  type SiteStatus,
  viaOf,
} from "./autobrowse.js";
import type {
  AccountInsights,
  ActivityQuery,
  ActivityRow,
  Audience,
  CommentRow,
  ContentChannel,
  Insights,
  ListQuery,
  Platform,
  Post,
  ReportDays,
} from "./index.js";
import { PLATFORMS } from "./index.js";
import { fieldsOf, ShapeError } from "./shapes.js";

export type Channels = Partial<Record<Platform, ContentChannel>>;

export const SITES = { name: "sites" } as const;
/** The same service on the Mac (autobrowse `src/app/desk.ts`): legs a site refuses from the box's IP. */
export const DESK = { name: "desk" } as const;

/** The `sites` service's handlers as autobrowse serves them; no import from that repo. */
export type SitesService = {
  status: (ctx: restate.Context, req: { site: string }) => Promise<SiteStatus>;
  call: (
    ctx: restate.Context,
    req: {
      site: string;
      method: SiteMethod;
      path: string;
      input?: Record<string, unknown>;
      account?: string;
      /** Who in wren asked, for autobrowse's per-caller usage (`wren:crm-run`). */
      caller?: string;
    },
  ) => Promise<unknown>;
  setup: (
    ctx: restate.Context,
    req: { site: string; step: string },
  ) => Promise<{ made: readonly string[] }>;
};

/** A terminal error from `sites` carries the site's own status code; surface it as a SiteCallError. */
export function siteCallErrorFrom(err: unknown, site: string, method: string, path: string): Error {
  if (err instanceof restate.TerminalError)
    return new SiteCallError(site, method, path, err.code ?? 500, err.message);
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Where `sites` runs: `SITES` on the AWS box (woken before the first call) or `DESK`
 * on the Mac (never woken: it is on while the Mac is).
 */
export interface SitesHost {
  service: { name: string };
  wake?: Wake | undefined;
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
 * the call until the worker is back on the tunnel. `service`: `SITES` (the
 * box) or `DESK` (the Mac, never woken: it is on while the Mac is). `caller`
 * rides on every call, so autobrowse can say who spent a capped site's reads.
 */
export function restateSites(
  ctx: restate.Context,
  o: { caller: string } & Partial<SitesHost>,
): SiteClient {
  const { caller, wake, service = SITES } = o;
  const client = ctx.serviceClient<SitesService>(service);
  const statuses = new Map<string, Promise<SiteStatus>>();
  let woken: Promise<unknown> | null = null;
  const awake = () => {
    if (!wake) return Promise.resolve();
    woken ??= ctx.run("wake autobrowse", wake);
    return woken;
  };
  return {
    async call(site, method, path, input = {}, account) {
      await awake();
      try {
        return (await client.call({
          site,
          method,
          path,
          input,
          ...(account ? { account } : {}),
          caller,
        })) as never;
      } catch (err) {
        throw siteCallErrorFrom(err, site, method, path);
      }
    },
    async via(site, method, path) {
      await awake();
      const p = statuses.get(site) ?? client.status({ site });
      statuses.set(site, p);
      try {
        return viaOf(await p, method, path);
      } catch (err) {
        // A failed read is not the site's answer: the next call asks again.
        statuses.delete(site);
        throw siteCallErrorFrom(err, site, "GET", "status");
      }
    },
  };
}

/** A platform said no (bad input, forbidden, gone): retrying the same call cannot help. 408/429 can. */
export const isRefusal = (err: unknown): err is SiteCallError =>
  err instanceof SiteCallError &&
  err.status >= 400 &&
  err.status < 500 &&
  err.status !== 408 &&
  err.status !== 429;

/**
 * A direct API client (no `sites` hop) made durable: each call is one
 * journaled step, so a retried invocation replays the answer instead of
 * calling again. A refusal ends the step for good; anything else retries.
 */
export function journaledSites(ctx: restate.Context, sites: SiteClient): SiteClient {
  return {
    async call(site, method, path, input = {}, account) {
      try {
        return (await ctx.run(`${site} ${method} ${path}`, async () => {
          try {
            return ((await sites.call(site, method, path, input, account)) ?? null) as never;
          } catch (err) {
            if (isRefusal(err))
              throw new restate.TerminalError(err.message, { errorCode: err.status });
            throw err;
          }
        })) as never;
      } catch (err) {
        throw siteCallErrorFrom(err, site, method, path);
      }
    },
    via: (site, method, path) => sites.via(site, method, path),
  };
}

/**
 * A refusal from a channel is final for this request: terminal, so the scheduler marks the draft
 * failed. So is a client's vendor gate saying no: asking again this minute gets the same answer.
 */
async function refusalsFinal<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (isRefusal(err) || isVendorStop(err))
      throw new restate.TerminalError(err.message, { errorCode: err.status });
    // A field its platform won't take: the draft's to fix, never a retry.
    if (err instanceof ShapeError) throw new restate.TerminalError(err.message, { errorCode: 400 });
    throw err;
  }
}

/** Build the channels for one invocation from its context (the `sites` calls need it). */
export type ChannelsFor = (ctx: restate.Context) => Channels;

/** What a client's part is doing on its channels: posting, or reading (`content.social`). */
export type ContentPart = "content.posting" | "content.social";

export interface ContentClients {
  /** A client's channels on its own logins, reads metered as `part`; none: it has no login. */
  channels: (ctx: restate.Context, client: string, part: ContentPart) => Promise<Channels>;
  /** May a post or a reply leave for this client: its live flag and the global gate. */
  sends: (client: string) => Promise<boolean>;
}

export const SENDS_OFF = "Sends off. An admin turns them on.";

const PLATFORM = z.enum(PLATFORMS as [Platform, ...Platform[]]);
const QUERY = z
  .looseObject({
    limit: z.number().nullish(),
    before: z.string().nullish().describe("The last row's publishedAt; older rows come back"),
  })
  .nullish();
const PUBLISH = z.looseObject({
  platform: PLATFORM,
  post: z.looseObject({
    text: z.string(),
    media: z
      .looseObject({
        kind: z.string().describe("image or video"),
        source: z.string().describe("A URL, or a file the media host stores"),
        title: z.string().nullish().describe("Video title, image alt text"),
      })
      .nullish(),
    scheduledFor: z.string().nullish().describe("ISO time to publish at; empty = now"),
    extra: z
      .record(z.string(), z.unknown())
      .nullish()
      .describe("The platform's fields (its shape in content/shapes.ts): title, tags, subreddit"),
  }),
});
const ACTIVITY_QUERY = z
  .looseObject({
    since: z.string().nullish().describe("ISO time: only rows at or after it"),
    limit: z.number().nullish(),
  })
  .nullish();
/** A client's id: its own logins, not Wren's. Empty: Wren's. */
const CLIENT = z.string().nullish().describe("A client's id; empty = Wren's own channels");
type ForClient = { client?: string | null };
const ONE_POST = z.looseObject({ platform: PLATFORM, id: z.string(), client: CLIENT });
const REPLY = z.looseObject({
  platform: PLATFORM,
  commentId: z.string(),
  text: z.string(),
  client: CLIENT,
});

export function makeContent(channelsFor: ChannelsFor, clients?: ContentClients) {
  /** Wren's channel, or a client's on its own login (`client`). */
  const pick = async (
    ctx: restate.Context,
    platform: Platform,
    client: string | null | undefined,
    part: ContentPart = "content.posting",
  ): Promise<ContentChannel> => {
    if (client && !clients)
      throw new restate.TerminalError("no client channels here", { errorCode: 404 });
    const ch =
      client && clients
        ? (await clients.channels(ctx, client, part))[platform]
        : channelsFor(ctx)[platform];
    if (!ch)
      throw new restate.TerminalError(
        client
          ? `${client} has no ${platform} login connected`
          : `no ${platform} channel configured`,
        { errorCode: 404 },
      );
    return ch;
  };
  /** A client's post or reply: refused while its sends are off. */
  const sending = async (ctx: restate.Context, client: string | null | undefined) => {
    if (!client) return;
    const on = await ctx.run("sends", () => clients?.sends(client) ?? Promise.resolve(false));
    if (!on) throw new restate.TerminalError(SENDS_OFF, { errorCode: 403 });
  };
  return restate.service({
    name: "Content",
    handlers: {
      platforms: serviceHandler(
        { input: NO_INPUT },
        async (ctx: restate.Context): Promise<Platform[]> => {
          const channels = channelsFor(ctx);
          return (Object.keys(channels) as Platform[]).filter((p) => channels[p]);
        },
      ),
      publish: serviceHandler(
        { input: PUBLISH.extend({ client: CLIENT }), effect: "posts" },
        async (ctx: restate.Context, req: { platform: Platform; post: Post } & ForClient) => {
          await sending(ctx, req.client);
          const ch = await pick(ctx, req.platform, req.client);
          return refusalsFinal(
            Promise.resolve()
              .then(() => fieldsOf(req.platform, req.post.extra))
              .then(() => ch.publish(req.post)),
          );
        },
      ),
      list: serviceHandler(
        { input: z.looseObject({ platform: PLATFORM, q: QUERY, client: CLIENT }) },
        async (ctx: restate.Context, req: { platform: Platform; q?: ListQuery } & ForClient) =>
          refusalsFinal((await pick(ctx, req.platform, req.client)).list(req.q ?? {})),
      ),
      metrics: serviceHandler(
        { input: ONE_POST },
        async (ctx: restate.Context, req: { platform: Platform; id: string } & ForClient) =>
          refusalsFinal((await pick(ctx, req.platform, req.client)).metrics(req.id)),
      ),
      comments: serviceHandler(
        { input: ONE_POST.extend({ q: QUERY }) },
        async (
          ctx: restate.Context,
          req: { platform: Platform; id: string; q?: ListQuery } & ForClient,
        ) =>
          refusalsFinal(
            (await pick(ctx, req.platform, req.client, "content.social")).comments(
              req.id,
              req.q ?? {},
            ),
          ),
      ),
      reply: serviceHandler(
        { input: REPLY, effect: "posts" },
        async (
          ctx: restate.Context,
          req: { platform: Platform; commentId: string; text: string } & ForClient,
        ) => {
          await sending(ctx, req.client);
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          if (!ch.reply)
            throw new restate.TerminalError(`${req.platform} cannot reply here`, {
              errorCode: 501,
            });
          await refusalsFinal(ch.reply(req.commentId, req.text));
        },
      ),
      /** Reviews of the account itself (Business Profile). Null when the channel has none. */
      reviews: serviceHandler(
        { input: z.looseObject({ platform: PLATFORM, q: ACTIVITY_QUERY, client: CLIENT }) },
        async (
          ctx: restate.Context,
          req: { platform: Platform; q?: ActivityQuery | null } & ForClient,
        ): Promise<CommentRow[] | null> => {
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          return ch.reviews ? refusalsFinal(ch.reviews(req.q ?? {})) : null;
        },
      ),
      /** Null when the channel reads no activity, so a caller skips it without an error. */
      activity: serviceHandler(
        { input: z.looseObject({ platform: PLATFORM, q: ACTIVITY_QUERY, client: CLIENT }) },
        async (
          ctx: restate.Context,
          req: { platform: Platform; q?: ActivityQuery | null } & ForClient,
        ): Promise<ActivityRow[] | null> => {
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          return ch.activity ? refusalsFinal(ch.activity(req.q ?? {})) : null;
        },
      ),
      /** Null when the channel reads no follower count. Any failure is final: the caller asks again later. */
      audience: serviceHandler(
        { input: z.looseObject({ platform: PLATFORM, client: CLIENT }) },
        async (
          ctx: restate.Context,
          req: { platform: Platform } & ForClient,
        ): Promise<Audience | null> => {
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          if (!ch.audience) return null;
          try {
            return await ch.audience();
          } catch (err) {
            throw new restate.TerminalError(err instanceof Error ? err.message : String(err));
          }
        },
      ),
      /**
       * A post's deeper numbers, and a gap for each its token can't read
       * (designs/2026-10-07-content-analytics.md). Null when the channel reads none.
       */
      insights: serviceHandler(
        {
          input: ONE_POST.extend({
            published: z.string().nullish().describe("ISO time it went up"),
            kind: z.string().nullish().describe("Its shape's kind: short, video, carousel"),
            media: z.enum(["image", "video"]).nullish().describe("What it carries"),
          }),
        },
        async (
          ctx: restate.Context,
          req: {
            platform: Platform;
            id: string;
            published?: string | null;
            kind?: string | null;
            media?: "image" | "video" | null;
          } & ForClient,
        ): Promise<Insights | null> => {
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          if (!ch.insights) return null;
          return refusalsFinal(
            ch.insights({
              id: req.id,
              published: req.published ?? null,
              kind: req.kind ?? null,
              media: req.media ?? null,
            }),
          );
        },
      ),
      /** The account's numbers per day. Null when the channel reads none. */
      accountInsights: serviceHandler(
        { input: z.looseObject({ platform: PLATFORM, client: CLIENT }) },
        async (
          ctx: restate.Context,
          req: { platform: Platform } & ForClient,
        ): Promise<AccountInsights | null> => {
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          return ch.accountInsights ? refusalsFinal(ch.accountInsights()) : null;
        },
      ),
      /** Every post's numbers per day from the platform's bulk reports. Null when it has none. */
      reportDays: serviceHandler(
        {
          input: z.looseObject({
            platform: PLATFORM,
            after: z.string().nullish().describe("Only reports made after this ISO time"),
            client: CLIENT,
          }),
        },
        async (
          ctx: restate.Context,
          req: { platform: Platform; after?: string | null } & ForClient,
        ): Promise<ReportDays | null> => {
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          return ch.reportDays ? refusalsFinal(ch.reportDays({ after: req.after ?? null })) : null;
        },
      ),
    },
  });
}
export type Content = ReturnType<typeof makeContent>;
