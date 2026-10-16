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
import type { Seen } from "../maybe-sent.js";
import { isVendorStop } from "../metered.js";
import { NO_INPUT, serviceHandler } from "../restate/form.js";
import { CallTimeout, within } from "../restate/limits.js";
import {
  capWaitMs,
  MAY_HAVE_POSTED,
  mayHavePosted,
  SiteCallError,
  type SiteClient,
  type SiteMethod,
  type SiteStatus,
  sentState,
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
  MediaHost,
  Metrics,
  Platform,
  Post,
  PostPatch,
  PrivateReplyQuery,
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
  /** `call`'s browser leg up to its last safe step, nothing sent (autobrowse designs/2026-10-12-watchers-and-arming.md). */
  arm: (
    ctx: restate.Context,
    req: {
      site: string;
      method: SiteMethod;
      path: string;
      input?: Record<string, unknown>;
      account?: string;
      caller?: string;
    },
  ) => Promise<unknown>;
};

/**
 * Thrown by an arming client (`restateSites` with `arm`) at the first write: the write went to
 * `sites/arm` instead, and the channel stops there.
 */
export class ArmedStop extends Error {
  constructor() {
    super("armed");
    this.name = "ArmedStop";
  }
}

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
  /**
   * Arm instead of write: the first non-GET call is sent to `sites/arm` (one way) and throws
   * `ArmedStop`. Reads still run, so a channel builds the same write it would send.
   */
  arm?: boolean;
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
 * `limitMs`: a loop's client waits on each call at most this long; past it the call is
 * cancelled and `CallTimeout` (terminal) thrown, never tried again in this pass.
 */
export function restateSites(
  ctx: restate.Context,
  o: { caller: string; limitMs?: number } & Partial<SitesHost>,
): SiteClient {
  const { caller, wake, service = SITES, arm = false, limitMs } = o;
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
      if (arm && method !== "GET") {
        ctx.serviceSendClient<SitesService>(service).arm({
          site,
          method,
          path,
          input,
          ...(account ? { account } : {}),
          caller,
        });
        throw new ArmedStop();
      }
      await awake();
      for (let attempt = 1; ; attempt++) {
        try {
          const call = client.call({
            site,
            method,
            path,
            input,
            ...(account ? { account } : {}),
            caller,
          });
          return (await (limitMs === undefined
            ? call
            : within(ctx, call, {
                ms: limitMs,
                call: `${service.name}/call ${site} ${method} ${path}`,
                // A write past its wait may still land: left running, never sent again.
                ...(safeToRepeat(method, path) ? {} : { keep: true, note: MAY_HAVE_POSTED }),
              }))) as never;
        } catch (err) {
          if (err instanceof CallTimeout) throw err;
          const e = siteCallErrorFrom(err, site, method, path);
          if (!(e instanceof SiteCallError)) throw e;
          if (attempt < CALL_TRIES && !isRefusal(e) && safeToRepeat(method, path)) {
            await ctx.sleep(attempt * CALL_PAUSE_MS);
            continue;
          }
          const out =
            safeToRepeat(method, path) || isRefusal(e) ? e : unsure(e, site, method, path);
          out.journaled = true;
          throw out;
        }
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

/** Tries of one `sites` call that failed in passing (a dropped socket, a 5xx), paused between. */
const CALL_TRIES = 3;
const CALL_PAUSE_MS = 30_000;

/** Calls that change nothing a person sees: a read, or a file's upload before any post names it. */
const safeToRepeat = (method: SiteMethod, path: string) =>
  method === "GET" || /\/upload\b/.test(path);

/**
 * A write that failed in passing: it may have reached the platform, so it says so. autobrowse
 * says which itself (`not sent: …` or `…; may have gone through`); its words stand. Untagged
 * words (an older desk) still read as maybe.
 */
function unsure(e: SiteCallError, site: string, method: string, path: string): SiteCallError {
  if (mayHavePosted(e.message) || sentState(e.message) !== null) return e;
  const prefix = `${site} ${method} ${path}: ${e.status} `;
  const said = e.message.startsWith(prefix) ? e.message.slice(prefix.length) : e.message;
  return new SiteCallError(site, method, path, e.status, `${said}; ${MAY_HAVE_POSTED}`);
}

/**
 * A platform said no (bad input, forbidden, gone): retrying the same call cannot help. 408 and
 * a short 429 can; a 429 whose wait is hours (a used daily cap) cannot, and retrying it would
 * pause the caller's loop until someone resumes it. A 501 (no leg, no recorded workflow yet)
 * stays one until someone builds it.
 */
export const isRefusal = (err: unknown): err is SiteCallError =>
  err instanceof SiteCallError &&
  ((err.status >= 400 && err.status < 500) || err.status === 501) &&
  err.status !== 408 &&
  (err.status !== 429 || capWaitMs(err) !== null);

/**
 * A media host made durable: each source is signed once, in a journaled step,
 * so a retried invocation hands the site the same URL. A fresh signature on
 * replay is a different call input, and Restate stops the invocation on the
 * journal mismatch (10-14: a Facebook short stuck backing off).
 */
export function journaledHost(ctx: restate.Context, host: MediaHost): MediaHost {
  return { host: (source) => ctx.run(`sign ${source}`, () => host.host(source)) };
}

/**
 * A direct API client (no `sites` hop) made durable: each call is one
 * journaled step, so a retried invocation replays the answer instead of
 * calling again. A refusal ends the step for good. A read retries; a write
 * that failed any other way may have gone through, so it is never sent blind
 * again: final, and said so.
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
            if (safeToRepeat(method, path) || nothingSent(err)) throw err;
            const status = err instanceof SiteCallError ? err.status : 502;
            const said = err instanceof Error ? err.message : String(err);
            // autobrowse's own words say whether it left; untagged ones read as maybe.
            throw new restate.TerminalError(
              sentState(said) ? said : `${said}; ${MAY_HAVE_POSTED}`,
              {
                errorCode: status >= 400 ? status : 502,
              },
            );
          }
        })) as never;
      } catch (err) {
        throw siteCallErrorFrom(err, site, method, path);
      }
    },
    via: (site, method, path) => sites.via(site, method, path),
  };
}

/** The connection never opened: nothing reached the platform, so trying again is safe. */
const nothingSent = (err: unknown): boolean =>
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(
    `${(err as { code?: string })?.code ?? ""} ${(err as { cause?: { code?: string } })?.cause?.code ?? ""}`,
  );

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
    // A journaled failure replays on every retry: final for this call, so its caller moves on.
    if (err instanceof SiteCallError && err.journaled)
      throw new restate.TerminalError(err.message, { errorCode: err.status || 502 });
    // A field its platform won't take: the draft's to fix, never a retry.
    if (err instanceof ShapeError) throw new restate.TerminalError(err.message, { errorCode: 400 });
    throw err;
  }
}

/**
 * A read that only saves calls (`metricsMany`, `commentCounts`): any failure is final for the
 * call, never a retry, so its caller moves on to the one-by-one read it would have made.
 */
async function orFallBack<T>(work: Promise<T>): Promise<T> {
  try {
    return await refusalsFinal(work);
  } catch (err) {
    if (err instanceof restate.TerminalError) throw err;
    throw new restate.TerminalError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Build the channels for one invocation from its context (the `sites` calls need it). `arm`:
 * channels whose writes arm the browser instead of sending (`SitesHost.arm`).
 */
/**
 * Wren's channels for one invocation. `account`: post as that login (`reddit@alt`), a person's
 * pick on the draft (designs/2026-10-15-accounts-first-class.md); absent, each platform's default.
 */
export type ChannelsFor = (
  ctx: restate.Context,
  o?: { arm?: boolean; account?: string | null },
) => Channels;

/** What a client's part is doing on its channels: posting, or reading (`content.social`). */
export type ContentPart = "content.posting" | "content.social";

export interface ContentClients {
  /** A client's channels on its own logins, reads metered as `part`; none: it has no login. */
  channels: (ctx: restate.Context, client: string, part: ContentPart) => Promise<Channels>;
  /** May a post or a reply leave for this client: its live flag and the global gate. */
  sends: (client: string) => Promise<boolean>;
}

/** Most posts one `metricsMany` or `commentCounts` asks about; a listing page is 100. */
export const MANY_POSTS = 100;

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
const ACCOUNT = z
  .string()
  .max(120)
  .nullish()
  .describe("Wren's login to post as (`reddit@alt`); empty = the platform's default");
type AsAccount = { account?: string | null };
const ONE_POST = z.looseObject({ platform: PLATFORM, id: z.string(), client: CLIENT });
const REPLY = z.looseObject({
  platform: PLATFORM,
  commentId: z.string(),
  /** The post the comment is on: LinkedIn's bare comment ids need it. */
  postId: z.string().nullish(),
  text: z.string(),
  client: CLIENT,
});

const UPDATE = ONE_POST.extend({
  patch: z.looseObject({
    title: z.string().min(1).max(100).optional().describe("The new title"),
    thumbnail: z.string().min(1).optional().describe("A stored image: the new thumbnail"),
    hook: z.string().min(1).optional().describe("The new first line of the text"),
  }),
});

export function makeContent(channelsFor: ChannelsFor, clients?: ContentClients) {
  /** Wren's channel, or a client's on its own login (`client`). */
  const pick = async (
    ctx: restate.Context,
    platform: Platform,
    client: string | null | undefined,
    part: ContentPart = "content.posting",
    account?: string | null,
  ): Promise<ContentChannel> => {
    if (client && !clients)
      throw new restate.TerminalError("no client channels here", { errorCode: 404 });
    const ch =
      client && clients
        ? (await clients.channels(ctx, client, part))[platform]
        : channelsFor(ctx, account ? { account } : undefined)[platform];
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
        { input: PUBLISH.extend({ client: CLIENT, account: ACCOUNT }), effect: "posts" },
        async (
          ctx: restate.Context,
          req: { platform: Platform; post: Post } & ForClient & AsAccount,
        ) => {
          await sending(ctx, req.client);
          const ch = await pick(ctx, req.platform, req.client, "content.posting", req.account);
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
      /**
       * Several posts' numbers in as few platform reads as the channel can. Null when it has no
       * batch read; a post missing from the answer is for the caller to read with `metrics`.
       */
      metricsMany: serviceHandler(
        {
          input: z.looseObject({
            platform: PLATFORM,
            posts: z
              .array(
                z.looseObject({
                  id: z.string(),
                  kind: z.string().nullish().describe("Its shape's kind: short, video, carousel"),
                }),
              )
              .min(1)
              .max(MANY_POSTS),
            client: CLIENT,
          }),
        },
        async (
          ctx: restate.Context,
          req: { platform: Platform; posts: { id: string; kind?: string | null }[] } & ForClient,
        ): Promise<Metrics[] | null> => {
          const ch = await pick(ctx, req.platform, req.client);
          return ch.metricsMany ? orFallBack(ch.metricsMany(req.posts)) : null;
        },
      ),
      /** Comment counts by post id in one read. Null when the channel can't count without reading. */
      commentCounts: serviceHandler(
        {
          input: z.looseObject({
            platform: PLATFORM,
            ids: z.array(z.string()).min(1).max(MANY_POSTS),
            client: CLIENT,
          }),
        },
        async (
          ctx: restate.Context,
          req: { platform: Platform; ids: string[] } & ForClient,
        ): Promise<Record<string, number> | null> => {
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          return ch.commentCounts ? orFallBack(ch.commentCounts(req.ids)) : null;
        },
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
        { input: REPLY.extend({ account: ACCOUNT }), effect: "posts" },
        async (
          ctx: restate.Context,
          req: {
            platform: Platform;
            commentId: string;
            postId?: string | null;
            text: string;
          } & ForClient &
            AsAccount,
        ) => {
          await sending(ctx, req.client);
          const ch = await pick(ctx, req.platform, req.client, "content.social", req.account);
          if (!ch.reply)
            throw new restate.TerminalError(`${req.platform} cannot reply here`, {
              errorCode: 501,
            });
          await refusalsFinal(ch.reply(req.commentId, req.text, { postId: req.postId ?? null }));
        },
      ),
      /**
       * Warm a reply that waits on a yes: its browser leg runs to the reply box, nothing typed, so
       * the yes sends at once. Wren's own channels only; never fails (`armed: false` instead).
       */
      arm: serviceHandler(
        { input: REPLY },
        async (
          ctx: restate.Context,
          req: {
            platform: Platform;
            commentId: string;
            postId?: string | null;
            text: string;
          } & ForClient,
        ): Promise<{ armed: boolean }> => {
          const ch = req.client ? null : channelsFor(ctx, { arm: true })[req.platform];
          if (!ch?.reply) return { armed: false };
          try {
            await ch.reply(req.commentId, req.text, { postId: req.postId ?? null });
          } catch (err) {
            return { armed: err instanceof ArmedStop };
          }
          return { armed: false };
        },
      ),
      /** One DM to a comment's author, as a reply to it; 501 where the platform has no such door. */
      privateReply: serviceHandler(
        { input: REPLY, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { platform: Platform; commentId: string; text: string } & ForClient,
        ): Promise<{ ref: string | null }> => {
          await sending(ctx, req.client);
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          if (!ch.privateReply)
            throw new restate.TerminalError(`${req.platform} has no DM from a comment`, {
              errorCode: 501,
            });
          return refusalsFinal(ch.privateReply(req.commentId, req.text));
        },
      ),
      /**
       * Our own reply under a post or comment, read back after its send's outcome was lost
       * (designs/2026-10-16-maybe-sent.md). A read: any failure, or a channel with no such read,
       * answers unclear, never an error.
       */
      findReply: serviceHandler(
        {
          input: z.looseObject({
            platform: PLATFORM,
            on: z.string().describe("The post or comment we answered"),
            to: z.string().nullish().describe("Its author's handle"),
            text: z.string(),
            since: z.string().describe("When the send began, ISO"),
            client: CLIENT,
          }),
        },
        async (
          ctx: restate.Context,
          req: {
            platform: Platform;
            on: string;
            to?: string | null;
            text: string;
            since: string;
          } & ForClient,
        ): Promise<Seen> => {
          try {
            const ch = await pick(ctx, req.platform, req.client, "content.social");
            if (!ch.findReply)
              return { kind: "unclear", why: `${req.platform} can't read our reply back` };
            return await ch.findReply({
              on: req.on,
              to: req.to ?? null,
              text: req.text,
              since: req.since,
            });
          } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            return { kind: "unclear", why: `the read failed: ${why.slice(0, 200)}` };
          }
        },
      ),
      /**
       * Our private reply to a comment, read back from the Page's inbox after its send's outcome
       * was lost (designs/2026-10-16-maybe-sent.md). A read: any failure, or a channel with no
       * such read, answers unclear, never an error.
       */
      findPrivateReply: serviceHandler(
        {
          input: z.looseObject({
            platform: PLATFORM,
            commentId: z.string().describe("The comment we answered"),
            to: z.string().describe("Its author: a handle on Instagram, a name on Facebook"),
            text: z.string(),
            since: z.string().describe("When the send began, ISO"),
            client: CLIENT,
          }),
        },
        async (
          ctx: restate.Context,
          req: { platform: Platform } & PrivateReplyQuery & ForClient,
        ): Promise<Seen> => {
          try {
            const ch = await pick(ctx, req.platform, req.client, "content.social");
            if (!ch.findPrivateReply)
              return { kind: "unclear", why: `${req.platform} can't read a private reply back` };
            return await ch.findPrivateReply({
              commentId: req.commentId,
              to: req.to,
              text: req.text,
              since: req.since,
            });
          } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            return { kind: "unclear", why: `the read failed: ${why.slice(0, 200)}` };
          }
        },
      ),
      /**
       * A swap on a live post (title, thumbnail, hook): a publish, so only after his yes in To
       * approve. 501 where a post can't change once up.
       */
      update: serviceHandler(
        { input: UPDATE, effect: "posts" },
        async (
          ctx: restate.Context,
          req: { platform: Platform; id: string; patch: PostPatch } & ForClient,
        ) => {
          await sending(ctx, req.client);
          const ch = await pick(ctx, req.platform, req.client);
          if (!ch.update)
            throw new restate.TerminalError(`a ${req.platform} post can't change once it's up`, {
              errorCode: 501,
            });
          await refusalsFinal(ch.update(req.id, req.patch));
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
            read: z
              .unknown()
              .describe("What this look's metrics read answered, if it can be reused"),
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
            read?: unknown;
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
              read: req.read,
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
