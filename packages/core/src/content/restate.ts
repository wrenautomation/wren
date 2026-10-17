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
import { CallTimeout, within } from "../restate/limits.js";
import { type JournalRecord, openTry, type SendJournal } from "../send-journal.js";
import {
  type Delivery,
  deliveryOf,
  isSendOutcome,
  noteAnswer,
  outputOf,
  rechecking,
  type SendVerdict,
  terminalOf,
  unknownSend,
  verifyingOnly,
  writeKey,
} from "../send-verdict.js";
import {
  capWaitMs,
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
  MediaHost,
  Metrics,
  Platform,
  Post,
  PostPatch,
  Published,
  ReportDays,
} from "./index.js";
import { PLATFORMS } from "./index.js";
import { routeKind } from "./routes.js";
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
      /**
       * An irreversible call's send key (`writeKey`): with it autobrowse answers a `SendVerdict`
       * as the result (autobrowse designs/2026-10-16-send-verdicts.md).
       */
      sendKey?: string;
    },
  ) => Promise<unknown>;
  /**
   * What became of a keyed call, without making it: the stored verdict, or a fresh verify read
   * for an `unknown` one. The way to ask after a call Restate killed or lost.
   */
  verdict: (ctx: restate.Context, req: { sendKey: string }) => Promise<SendVerdict>;
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
 *
 * A write that cannot be undone (`routeKind` "send") made inside a key scope (`withSendKey`) is
 * keyed (`keyedCall`): autobrowse answers what became of it as a verdict, and this side never
 * reads its words. A write outside a scope is called once, as before. Reads and staging writes
 * (`routes.ts`) are never keyed and retry on a 5xx.
 *
 * In a verify-only scope a keyed write asks `verdict` and never calls. A write that is not keyed
 * (a read, a staging write) still runs.
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
  /** Wait on a call, at most `limitMs` when the client has one. A write stays running past it. */
  const waited = <T>(
    p: restate.RestatePromise<T> & Partial<Pick<restate.InvocationHandle, "invocationId">>,
    what: string,
    keep: boolean,
  ): Promise<T> =>
    limitMs === undefined
      ? p
      : within(ctx, p, { ms: limitMs, call: `${service.name}/${what}`, keep });
  /** What became of a keyed call, asked of the same service. A failed ask is `unknown`. */
  const askVerdict = async (
    site: string,
    method: SiteMethod,
    path: string,
    key: string,
    since: string,
  ): Promise<SendVerdict> => {
    try {
      return await waited(
        client.verdict({ sendKey: key }),
        `verdict ${site} ${method} ${path}`,
        true,
      );
    } catch (err) {
      const why =
        err instanceof CallTimeout
          ? "the verdict is still being read"
          : "the verdict could not be read";
      throw unknownSend(why, since);
    }
  };
  /** A keyed write: its key rides in the body and as Restate's idempotency key. */
  async function keyedCall(
    site: string,
    method: SiteMethod,
    path: string,
    input: Record<string, unknown>,
    account: string | undefined,
    key: string,
  ): Promise<never> {
    const since = new Date(await ctx.date.now()).toISOString();
    let answer: unknown;
    try {
      answer = await waited(
        client.call(
          { site, method, path, input, ...(account ? { account } : {}), caller, sendKey: key },
          restate.rpc.opts({ idempotencyKey: key }),
        ),
        `call ${site} ${method} ${path}`,
        true,
      );
    } catch (err) {
      // A write past its wait is left running: it may still land.
      if (err instanceof CallTimeout) throw unknownSend("the call is still running", since);
      const e = siteCallErrorFrom(err, site, method, path);
      if (!(e instanceof SiteCallError)) throw e;
      // A request that was wrong stays an error: nothing was attempted (a 408 or a kill, 409, may
      // have been). Any other end of a keyed call is asked after.
      if (e.status < 500 && e.status !== 408 && e.status !== 409) {
        e.journaled = true;
        throw e;
      }
      answer = await askVerdict(site, method, path, key, since);
    }
    if (!isVerdict(answer)) {
      // An older desk ignores the key and answers the official output.
      noteAnswer("sent");
      return answer as never;
    }
    const v =
      answer.verdict === "unknown" && rechecking()
        ? await askVerdict(site, method, path, key, since)
        : answer;
    return settled(site, method, path, v);
  }
  /** A keyed write in a verify-only scope: ask what became of it, never call. */
  async function keyedVerify(
    site: string,
    method: SiteMethod,
    path: string,
    key: string,
  ): Promise<never> {
    const since = new Date(await ctx.date.now()).toISOString();
    return settled(site, method, path, await askVerdict(site, method, path, key, since));
  }
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
      const repeatable = routeKind(site, method, path) !== "send";
      const key = repeatable ? null : writeKey(site, method, path);
      if (key)
        return verifyingOnly()
          ? keyedVerify(site, method, path, key)
          : keyedCall(site, method, path, input, account, key);
      for (let attempt = 1; ; attempt++) {
        try {
          return (await waited(
            client.call({
              site,
              method,
              path,
              input,
              ...(account ? { account } : {}),
              caller,
            }),
            `call ${site} ${method} ${path}`,
            // A write past its wait may still land: left running, never sent again.
            !repeatable,
          )) as never;
        } catch (err) {
          if (err instanceof CallTimeout) throw err;
          const e = siteCallErrorFrom(err, site, method, path);
          if (!(e instanceof SiteCallError)) throw e;
          if (attempt < CALL_TRIES && !isRefusal(e) && repeatable) {
            await ctx.sleep(attempt * CALL_PAUSE_MS);
            continue;
          }
          e.journaled = true;
          throw e;
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

/** An answer in autobrowse's verdict shape. An older desk's output is not. */
const isVerdict = (v: unknown): v is SendVerdict =>
  typeof v === "object" &&
  v !== null &&
  ["sent", "not_sent", "unknown"].includes((v as { verdict?: unknown }).verdict as string);

/** Tries of one `sites` call that failed in passing (a dropped socket, a 5xx), paused between. */
const CALL_TRIES = 3;
const CALL_PAUSE_MS = 30_000;

/**
 * A verdict as the caller sees it: the platform's no is a journaled `SiteCallError` (the caller's
 * cap and refusal logic read an error), anything else is `outputOf`. The one mapping for a
 * `sites` verdict and a send journal's.
 */
function settled(site: string, method: string, path: string, v: SendVerdict): never {
  if (v.verdict === "not_sent" && v.how === "refused") {
    noteAnswer("not_sent");
    const refused = new SiteCallError(site, method, path, v.status ?? 400, v.reason);
    refused.journaled = true;
    throw refused;
  }
  return outputOf<never>(v);
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
 * A direct API client (no `sites` hop) made durable: each call is one journaled step, so a
 * retried invocation replays the answer instead of calling again. A refusal ends the step for
 * good. A read retries.
 *
 * A write that cannot be undone (`routeKind` "send") inside a key scope is keyed, with the same
 * contract as autobrowse's desk (send-verdicts): one journal record per key, written before the
 * act. The step answers a `SendVerdict` as a value, and outside the step `settled` maps it as
 * `restateSites` does. A key with a final verdict answers it with no call. A record with no
 * verdict, or an `unknown` one, answers `unknown`: these routes have no verify read, so
 * `recheck` changes nothing. A crash inside the step leaves a record with no verdict, so the
 * replay is `unknown`, never a second write.
 *
 * In a verify-only scope the step reads the journal and never writes: no record is `not_sent`.
 * A write outside a scope, a read and a staging write keep the plain step: a write that failed
 * any other way may have gone out, so it is never sent blind again (`SendUnknown`).
 */
export function journaledSites(
  ctx: restate.Context,
  sites: SiteClient,
  journal: SendJournal,
): SiteClient {
  /** The verdict the journal holds for a key, or the one for a try that left no end. */
  const known = (r: JournalRecord): SendVerdict =>
    r.verdict && r.verdict.verdict !== "unknown" ? r.verdict : openTry(r);
  /** Call the platform for the first time under this key and map its end. */
  async function act(
    site: string,
    method: SiteMethod,
    path: string,
    input: Record<string, unknown>,
    account: string | undefined,
  ): Promise<SendVerdict> {
    try {
      const output = ((await sites.call(site, method, path, input, account)) ?? null) as unknown;
      return {
        verdict: "sent",
        id: null,
        url: null,
        at: new Date().toISOString(),
        how: "answer",
        output,
      };
    } catch (err) {
      if (
        err instanceof SiteCallError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408
      )
        return { verdict: "not_sent", how: "refused", reason: err.message, status: err.status };
      if (nothingSent(err))
        return {
          verdict: "not_sent",
          how: "before_submit",
          reason: err instanceof Error ? err.message : String(err),
        };
      return {
        verdict: "unknown",
        reason: err instanceof Error ? err.message : String(err),
        since: new Date().toISOString(),
      };
    }
  }
  return {
    async call(site, method, path, input = {}, account) {
      const key = routeKind(site, method, path) === "send" ? writeKey(site, method, path) : null;
      if (key) {
        const name = `${site} ${method} ${path}`;
        const verdict = verifyingOnly()
          ? await ctx.run(name, async (): Promise<SendVerdict> => {
              const r = await journal.read(key);
              return r
                ? known(r)
                : {
                    verdict: "not_sent",
                    how: "before_submit",
                    reason: "no try began under this key",
                  };
            })
          : await ctx.run(name, async (): Promise<SendVerdict> => {
              const now = new Date();
              const begun = await journal.begin(
                { key, site, method, path, account: account ?? null },
                now,
              );
              if (!begun.won) return known(begun.record);
              const v = await act(site, method, path, input, account);
              await journal.settle(key, v, new Date());
              return v;
            });
        return settled(site, method, path, verdict);
      }
      let ran: { out: unknown } | { lost: string; since: string };
      try {
        ran = await ctx.run(`${site} ${method} ${path}`, async () => {
          try {
            return {
              out: ((await sites.call(site, method, path, input, account)) ?? null) as unknown,
            };
          } catch (err) {
            if (isRefusal(err))
              throw new restate.TerminalError(err.message, { errorCode: err.status });
            if (routeKind(site, method, path) !== "send" || nothingSent(err)) throw err;
            return {
              lost: err instanceof Error ? err.message : String(err),
              since: new Date().toISOString(),
            };
          }
        });
      } catch (err) {
        throw siteCallErrorFrom(err, site, method, path);
      }
      if ("lost" in ran) throw unknownSend(ran.lost, ran.since);
      return ran.out as never;
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
