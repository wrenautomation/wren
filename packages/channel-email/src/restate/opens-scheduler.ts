/**
 * The open-pixel pull as a Virtual Object with one key: every pass reads the
 * tracking host's export from the last row id we hold. Bound only when a pixel
 * host and its export credential are configured; the credential never reaches
 * the ledger row, the journal, or a log line.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { type OpenSyncStats, syncOpens } from "../inbox/opens.js";
import type { FetchLike } from "../verification/millionverifier.js";
import { makeLoopObject, runPass } from "./loop.js";

export interface OpensSchedulerDeps {
  db: Db;
  baseUrl: string;
  exportToken: string;
  fetch?: FetchLike;
  /** Between passes that returned (default 5 min). */
  syncMs?: number;
  /** After a pass that threw (default 1 min). */
  tickMs?: number;
}

export const OPENS_KEY = "fleet";
export const OPENS_SYNC_COMMAND = "outreach opens sync";

export function makeOpensScheduler(deps: OpensSchedulerDeps) {
  const syncMs = deps.syncMs ?? 300_000;
  const tickMs = deps.tickMs ?? 60_000;
  return makeLoopObject("OpensScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    return runPass<OpenSyncStats>(ctx, deps.db, now, {
      name: "opens sync",
      ledger: { command: OPENS_SYNC_COMMAND, argv: { daemon: true, base_url: deps.baseUrl } },
      body: (runId) =>
        syncOpens(deps.db, {
          baseUrl: deps.baseUrl,
          exportToken: deps.exportToken,
          runId,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        }),
      delayAfter: () => syncMs,
      retryMs: tickMs,
    });
  });
}

export type OpensScheduler = ReturnType<typeof makeOpensScheduler>;
