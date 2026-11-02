/**
 * The `sites` hop: every site call is a call to autobrowse's `sites` service on the same
 * Restate, so it is journaled, queues while the box is down, and a keyed write runs once. No port
 * on the box is ever reached from here. The `Content` service on top: `@wren/starling-core/service`.
 */
import * as restate from "@restatedev/restate-sdk";
import { SCHEDULE_ZONE } from "../logic.js";
import { CallTimeout, within } from "../restate/limits.js";
import { type JournalRecord, openTry, type SendJournal } from "../send-journal.js";
import {
  noteAnswer,
  outputOf,
  rechecking,
  type SendVerdict,
  unknownSend,
  verifyingOnly,
  writeKey,
} from "../send-verdict.js";
import { dayEnd } from "../time.js";
import {
  capWaitMs,
  SiteCallError,
  type SiteClient,
  type SiteMethod,
  type SiteStatus,
  viaOf,
} from "./autobrowse.js";
import { routeKind } from "./routes.js";

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
      /** A write's day ends here (ISO): one the desk first runs later is not sent. */
      until?: string;
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
  // This invocation's own cancel: never a site's answer. A child cancelled alone is a 409 below.
  if (err instanceof restate.CancelledError) return err;
  if (err instanceof restate.TerminalError)
    return new SiteCallError(
      site,
      method,
      path,
      err.code ?? 500,
      err.message,
      err.metadata?.code ?? null,
    );
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
  /**
   * The zone whose day a write belongs to (default Wren's, `SCHEDULE_ZONE`). A write the desk
   * first runs after that day ends is not sent: the Mac was off all day (William, 10-26).
   */
  dayZone?: string;
}

/** Past a keyed write's `until`, how long its answer may still take (clock skew, a leg mid-run). */
export const SEND_GRACE_MS = 30 * 60_000;

/**
 * When the wait on a keyed write begun at `at` ends: its day's end plus `SEND_GRACE_MS`. The desk
 * never starts it after its day, so past this an answer is final and "no record" means not sent.
 */
export const keyedWaitEnds = (at: Date, zone = SCHEDULE_ZONE): Date =>
  new Date(dayEnd(zone, at).getTime() + SEND_GRACE_MS);

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
 * cancelled and `CallTimeout` (terminal) thrown, never tried again in this pass. Not a keyed
 * write: it waits for the desk's answer up to `keyedWaitEnds` (WA-979).
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
  const { caller, wake, service = SITES, arm = false, limitMs, dayZone = SCHEDULE_ZONE } = o;
  /** The end of the day `at` falls on: a write past it waits for its caller, never lands late. */
  const untilOf = (at: number) => dayEnd(dayZone, new Date(at)).toISOString();
  const client = ctx.serviceClient<SitesService>(service);
  const statuses = new Map<string, Promise<SiteStatus>>();
  /**
   * This invocation's cancel, once seen: every later call throws it at once. A channel loop that
   * skips a failed post (`catch { continue }`) then ends, never waiting on the desk again: a
   * cancelled invocation waiting on a call replays in a hot loop on Lambda (10-30: 5.8M runs in
   * 12 h, the Mac off).
   */
  let cancelled: restate.CancelledError | null = null;
  const cancelledBy = (err: unknown) => {
    if (err instanceof restate.CancelledError) cancelled = err;
    return cancelled;
  };
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
      if (cancelledBy(err)) throw err;
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
    const began = await ctx.date.now();
    const since = new Date(began).toISOString();
    let answer: unknown;
    try {
      // Not `limitMs`: a queued write still lands, and "no record" is only final past its day.
      answer = await within(
        ctx,
        client.call(
          {
            site,
            method,
            path,
            input,
            ...(account ? { account } : {}),
            caller,
            sendKey: key,
            until: untilOf(began),
          },
          restate.rpc.opts({ idempotencyKey: key }),
        ),
        {
          ms: Math.max(keyedWaitEnds(new Date(began), dayZone).getTime() - began, 60_000),
          call: `${service.name}/call ${site} ${method} ${path}`,
          keep: true,
        },
      );
    } catch (err) {
      if (cancelledBy(err)) throw err;
      // Past its day: the journal's record says what it did; none means it never started.
      if (err instanceof CallTimeout)
        return settled(site, method, path, await askVerdict(site, method, path, key, since));
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
      if (cancelled) throw cancelled;
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
      const until = repeatable ? null : untilOf(await ctx.date.now());
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
              ...(until ? { until } : {}),
            }),
            `call ${site} ${method} ${path}`,
            // A write past its wait may still land: left running, never sent again.
            !repeatable,
          )) as never;
        } catch (err) {
          if (err instanceof CallTimeout || cancelledBy(err)) throw err;
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
      if (cancelled) throw cancelled;
      await awake();
      const p = statuses.get(site) ?? client.status({ site });
      statuses.set(site, p);
      try {
        return viaOf(await p, method, path);
      } catch (err) {
        if (cancelledBy(err)) throw err;
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
