/**
 * `TokenRenewal/box`: keeps autobrowse's tokens alive. A LinkedIn access token
 * lives 60 days with no refresh token; an npm token 90; any token can be
 * revoked or refused before then. `sites/renew` probes each site's token,
 * then makes again every refused one and every one lapsing within 14 days (a
 * browser consent signed in with the stored login). This object is the clock:
 * wake the host, call `renew`, post what happened, then sleep a day, so a
 * refused token waits at most a day even when nothing called it.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import type { Notifier } from "../notify.js";
import { errorText, makeLoopObject, type PassOutcome, runPass, within } from "../restate/index.js";
import { SITES, type SitesHost } from "./restate.js";

export const RENEWAL_KEY = "box";
export const RENEWAL_COMMAND = "sites renew";
const DAY_MS = 86_400_000;
/**
 * The longest a pass waits on `sites/renew`: it signs in a browser consent per refused or
 * lapsing token, minutes each. Past it the call runs on alone (it writes tokens) and the pass
 * says so; tomorrow's asks again.
 */
export const RENEW_WAIT_MS = 30 * 60_000;

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
  /** Where `sites/renew` runs (`sitesHost`); the box by default. */
  host?: SitesHost;
  notifier?: Notifier;
  /** How long a pass waits on `sites/renew` (default `RENEW_WAIT_MS`); tests shorten it. */
  limitMs?: number;
}

export function makeTokenRenewal(deps: TokenRenewalDeps) {
  return makeLoopObject("TokenRenewal", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const { service, wake } = deps.host ?? { service: SITES };
    if (wake) await ctx.run("wake autobrowse", wake);
    // A durable call: while the host is down it waits, then answers once the worker is back.
    let report: RenewReport | null = null;
    let refused: string | null = null;
    try {
      report = await within(ctx, ctx.serviceClient<SitesRenew>(service).renew({}), {
        ms: deps.limitMs ?? RENEW_WAIT_MS,
        call: `${service.name}/renew`,
        keep: true,
      });
    } catch (err) {
      // An old box without `renew`, a bad request, or no answer in time: this pass's problem,
      // asked again tomorrow.
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
      delayAfter: () => DAY_MS,
      retryMs: DAY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    }) as Promise<PassOutcome<RenewalStats>>;
  });
}

export type TokenRenewal = ReturnType<typeof makeTokenRenewal>;
