/**
 * The email click pull as a Virtual Object with one key: every pass reads the lander's `hits`
 * from the last view id we hold and counts the ones that came from an email link
 * (`email_clicks`, `../inbox/click-sync.ts`). Hourly: nothing acts on a click, the sent log and
 * `wren email clicks` only read them. Bound only when the lander's export credential is set; it
 * never reaches the ledger row, the journal, or a log line.
 */
import type * as restate from "@restatedev/restate-sdk";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { FetchLike } from "../fetch-like.js";
import { type ClickSyncStats, syncClicks } from "../inbox/click-sync.js";

export interface ClicksSchedulerDeps {
  db: Db;
  baseUrl: string;
  exportToken: string;
  fetch?: FetchLike;
  /** Between passes that returned (default 1 hour). */
  syncMs?: number;
  /** After a pass that threw: the backoff's cap (default 10 min). */
  tickMs?: number;
}

export const CLICKS_KEY = "fleet";
export const CLICKS_SYNC_COMMAND = "outreach clicks sync";

export function makeClicksScheduler(deps: ClicksSchedulerDeps) {
  const syncMs = deps.syncMs ?? 3_600_000;
  const tickMs = deps.tickMs ?? 600_000;
  return makeLoopObject("ClicksScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    return runPass<ClickSyncStats>(ctx, deps.db, now, {
      name: "clicks sync",
      ledger: { command: CLICKS_SYNC_COMMAND, argv: { daemon: true, base_url: deps.baseUrl } },
      body: () =>
        syncClicks(deps.db, {
          baseUrl: deps.baseUrl,
          exportToken: deps.exportToken,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        }),
      delayAfter: () => syncMs,
      retryMs: tickMs,
    });
  });
}

export type ClicksScheduler = ReturnType<typeof makeClicksScheduler>;
