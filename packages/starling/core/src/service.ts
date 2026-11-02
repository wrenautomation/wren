/**
 * The content channels as one Restate service, `Content`: publish and the
 * reads, keyed by platform. Every site call underneath is a call to
 * autobrowse's `sites` service on the same Restate, so it is journaled,
 * queues while the box is down, and a retry of `publish` never posts twice
 * (the worker runs a write once). No port on the box is ever reached from
 * here. The `sites` hop itself: `@wren/core/content/restate`.
 *
 * A request with `client` runs on that client's own logins (`ContentClients.channels`), its reads
 * through its vendor gate. A post or a reply for a client also waits on its live flag: until an
 * admin turns its posting on, the service refuses it (designs/2026-10-07-per-client-runs.md).
 */
import * as restate from "@restatedev/restate-sdk";
import { PLATFORMS, type Platform, SiteCallError } from "@wren/core/content";
import { ArmedStop, isRefusal } from "@wren/core/content/restate";
import { isVendorStop } from "@wren/core/metered";
import { NO_INPUT, serviceHandler } from "@wren/core/restate";
import { type Delivery, deliveryOf, isSendOutcome, terminalOf } from "@wren/core/send-verdict";
import { z } from "zod";
import type {
  AccountInsights,
  ActivityQuery,
  ActivityRow,
  Audience,
  CommentRow,
  ContentChannel,
  FollowingRow,
  Insights,
  ListQuery,
  MediaHost,
  Metrics,
  OwnCommentRow,
  Post,
  PostPatch,
  Published,
  ReportDays,
} from "./index.js";
import { fieldsOf, ShapeError } from "./shapes.js";

export type Channels = Partial<Record<Platform, ContentChannel>>;

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
 * A refusal from a channel is final for this request: terminal, so the scheduler marks the draft
 * failed. So is a client's vendor gate saying no: asking again this minute gets the same answer.
 */
async function refusalsFinal<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    // A send outcome that reaches here had no key to answer it as a value: final for this call.
    if (isSendOutcome(err)) throw terminalOf(err);
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
type ContentPart = "content.posting" | "content.social";

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
      .describe(
        "The platform's fields (its shape in @wren/starling-core/shapes): title, tags, subreddit",
      ),
  }),
});
const ACTIVITY_QUERY = z
  .looseObject({
    since: z.string().nullish().describe("ISO time: only rows at or after it"),
    limit: z.number().nullish(),
  })
  .nullish();
/**
 * A ledger send's key (`send_attempts.send_key`). With it the write runs under that key and the
 * handler answers a `Delivery` value, since a thrown error loses its type across the service
 * boundary (`deliveryOf`). Without it the handler answers as it always did.
 */
const SEND_KEY = z
  .string()
  .min(1)
  .max(200)
  .nullish()
  .describe("A ledger send's key: the answer is a Delivery value");
const RECHECK = z
  .boolean()
  .nullish()
  .describe("Check an unknown answer once more (a takeover, a person's check)");
const VERIFY_ONLY = z
  .boolean()
  .nullish()
  .describe("Ask what became of each keyed write; never write");
type Keyed = { sendKey?: string | null; recheck?: boolean | null; verifyOnly?: boolean | null };
/** A write under its ledger key, answered as a `Delivery`; without a key, as it always was. */
const keyed = <T>(req: Keyed, work: () => Promise<T>): Promise<T | Delivery<T>> =>
  refusalsFinal<T | Delivery<T>>(
    req.sendKey
      ? deliveryOf(req.sendKey, work, {
          recheck: req.recheck === true,
          verifyOnly: req.verifyOnly === true,
        })
      : work(),
  );
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
        {
          input: PUBLISH.extend({
            client: CLIENT,
            account: ACCOUNT,
            sendKey: SEND_KEY,
            recheck: RECHECK,
            verifyOnly: VERIFY_ONLY,
          }),
          effect: "posts",
        },
        async (
          ctx: restate.Context,
          req: { platform: Platform; post: Post } & ForClient & AsAccount & Keyed,
        ): Promise<Published | Delivery<Published>> => {
          await sending(ctx, req.client);
          const ch = await pick(ctx, req.platform, req.client, "content.posting", req.account);
          return keyed(req, () =>
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
        {
          input: REPLY.extend({
            account: ACCOUNT,
            sendKey: SEND_KEY,
            recheck: RECHECK,
            verifyOnly: VERIFY_ONLY,
          }),
          effect: "posts",
        },
        async (
          ctx: restate.Context,
          req: {
            platform: Platform;
            commentId: string;
            postId?: string | null;
            text: string;
          } & ForClient &
            AsAccount &
            Keyed,
        ): Promise<void | Delivery<void>> => {
          await sending(ctx, req.client);
          const ch = await pick(ctx, req.platform, req.client, "content.social", req.account);
          if (!ch.reply)
            throw new restate.TerminalError(`${req.platform} cannot reply here`, {
              errorCode: 501,
            });
          const reply = ch.reply.bind(ch);
          return keyed(req, () => reply(req.commentId, req.text, { postId: req.postId ?? null }));
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
        {
          input: REPLY.extend({ sendKey: SEND_KEY, recheck: RECHECK, verifyOnly: VERIFY_ONLY }),
          effect: "sends",
        },
        async (
          ctx: restate.Context,
          req: { platform: Platform; commentId: string; text: string } & ForClient & Keyed,
        ): Promise<{ ref: string | null } | Delivery<{ ref: string | null }>> => {
          await sending(ctx, req.client);
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          if (!ch.privateReply)
            throw new restate.TerminalError(`${req.platform} has no DM from a comment`, {
              errorCode: 501,
            });
          const privateReply = ch.privateReply.bind(ch);
          return keyed(req, () => privateReply(req.commentId, req.text));
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
      /** Null when the channel lists no follows. Any failure is final: the caller asks again later. */
      following: serviceHandler(
        { input: z.looseObject({ platform: PLATFORM, client: CLIENT }) },
        async (
          ctx: restate.Context,
          req: { platform: Platform } & ForClient,
        ): Promise<FollowingRow[] | null> => {
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          if (!ch.following) return null;
          try {
            return await ch.following();
          } catch (err) {
            throw new restate.TerminalError(err instanceof Error ? err.message : String(err));
          }
        },
      ),
      /** Null when the channel lists none of our comments. Any failure is final: the caller asks again later. */
      ownComments: serviceHandler(
        { input: z.looseObject({ platform: PLATFORM, client: CLIENT }) },
        async (
          ctx: restate.Context,
          req: { platform: Platform } & ForClient,
        ): Promise<OwnCommentRow[] | null> => {
          const ch = await pick(ctx, req.platform, req.client, "content.social");
          if (!ch.ownComments) return null;
          try {
            return await ch.ownComments();
          } catch (err) {
            throw new restate.TerminalError(err instanceof Error ? err.message : String(err));
          }
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
