/**
 * `TokenRenewal/box`: keeps autobrowse's tokens from lapsing. A LinkedIn
 * access token lives 60 days with no refresh token; an npm token 90. The
 * box keeps each with its lapse date and `sites/renew` makes again what
 * lapses within 14 days (a browser consent signed in with the stored login).
 * This object is the clock: wake the box, call `renew`, post what happened,
 * then sleep until 14 days before the next lapse (at least a day, at most a
 * week, so a token minted meanwhile is never missed by more than that).
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import type { Notifier } from "../notify.js";
import { errorText, makeLoopObject, type PassOutcome, runPass } from "../restate/index.js";
import { SITES, type Wake } from "./restate.js";

export const RENEWAL_KEY = "box";
export const RENEWAL_COMMAND = "sites renew";
const DAY_MS = 86_400_000;
export const RENEW_WITHIN_MS = 14 * DAY_MS;
const MIN_SLEEP_MS = DAY_MS;
const MAX_SLEEP_MS = 7 * DAY_MS;

/** What autobrowse's `sites/renew` answers (names, dates and lines; never a value). */
export interface RenewReport {
  lines: string[];
  results: Array<{ site: string; step: string; ok: boolean }>;
  next: string | null;
}

type SitesRenew = {
  renew: (ctx: restate.Context, req: { dry?: boolean }) => Promise<RenewReport>;
};

export interface RenewalStats {
  renewed: number;
  failed: number;
  lines: string[];
  next: string | null;
}

export interface TokenRenewalDeps {
  db: Db;
  wake?: Wake;
  notifier?: Notifier;
}

/** Sleep until 14 days before the next lapse, within a day and a week. */
export function renewalDelay(next: string | null, now: Date): number {
  if (!next) return MAX_SLEEP_MS;
  const until = Date.parse(next) - RENEW_WITHIN_MS - now.getTime();
  return Math.min(MAX_SLEEP_MS, Math.max(MIN_SLEEP_MS, until));
}

export function makeTokenRenewal(deps: TokenRenewalDeps) {
  return makeLoopObject("TokenRenewal", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const wake = deps.wake;
    if (wake) await ctx.run("wake autobrowse", wake);
    // A durable call: while the box is down it waits, then answers once the worker is back.
    let report: RenewReport | null = null;
    let refused: string | null = null;
    try {
      report = await ctx.serviceClient<SitesRenew>(SITES).renew({});
    } catch (err) {
      // An old box without `renew`, or a bad request: this pass's problem, asked again tomorrow.
      if (!(err instanceof restate.TerminalError)) throw err;
      refused = errorText(err);
    }
    const got = report;
    return runPass<RenewalStats>(ctx, deps.db, now, {
      name: "renew",
      ledger: { command: RENEWAL_COMMAND, argv: { daemon: true } },
      body: async () => {
        if (!got) throw new Error(`sites renew refused: ${refused}`);
        const stats: RenewalStats = {
          renewed: got.results.filter((r) => r.ok).length,
          failed: got.results.filter((r) => !r.ok).length,
          lines: got.lines,
          next: got.next,
        };
        if (got.lines.length)
          await deps.notifier?.notify(
            stats.failed ? "token renewal needs a hand" : "tokens renewed",
            got.lines.join("\n"),
            stats.failed ? "warning" : "info",
          );
        return stats;
      },
      delayAfter: (s) => renewalDelay(s.next, now),
      retryMs: MIN_SLEEP_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    }) as Promise<PassOutcome<RenewalStats>>;
  });
}

export type TokenRenewal = ReturnType<typeof makeTokenRenewal>;
