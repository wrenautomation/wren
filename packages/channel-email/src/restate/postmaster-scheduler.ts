/**
 * The daily Postmaster pull (U-D12) as a Virtual Object with one key. A pass
 * re-reads the last `days` for every sending domain (upserted: Google
 * publishes late and revises), then sleeps until the next local midnight —
 * whether or not it worked. A Postmaster outage must not become a call per
 * minute, and tomorrow's pull re-reads today's window anyway.
 */
import type * as restate from "@restatedev/restate-sdk";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import {
  type PostmasterClient,
  type PostmasterStats,
  syncPostmaster,
} from "../inbox/postmaster.js";
import type { SendPolicy } from "../send/policy.js";

export interface PostmasterSchedulerDeps {
  db: Db;
  client: PostmasterClient;
  /** The distinct domains the roster sends from, in roster order. */
  domains: readonly string[];
  /** For the local day boundary (the send timezone). */
  policy: SendPolicy;
  /** The window each pull re-reads (default 7 days). */
  days?: number;
}

export const POSTMASTER_KEY = "fleet";
export const POSTMASTER_SYNC_COMMAND = "outreach postmaster sync";

/** Ms from `now` to the next local midnight. */
export function untilNextLocalDay(policy: SendPolicy, now: Date): number {
  const [, nextMidnight] = policy.localDayBounds(now);
  return nextMidnight.getTime() - now.getTime();
}

export function makePostmasterScheduler(deps: PostmasterSchedulerDeps) {
  const days = deps.days ?? 7;
  return makeLoopObject("PostmasterScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const delay = untilNextLocalDay(deps.policy, now);
    return runPass<PostmasterStats>(ctx, deps.db, now, {
      name: "postmaster sync",
      ledger: {
        command: POSTMASTER_SYNC_COMMAND,
        argv: { daemon: true, days, domains: [...deps.domains] },
      },
      body: (runId) =>
        syncPostmaster(deps.db, {
          client: deps.client,
          domains: deps.domains,
          days,
          today: now.toISOString().slice(0, 10),
          runId,
        }),
      delayAfter: () => delay,
      retryMs: delay,
    });
  });
}

export type PostmasterScheduler = ReturnType<typeof makePostmasterScheduler>;
