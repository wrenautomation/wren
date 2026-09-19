/**
 * The inbox sync as a Virtual Object keyed by sender address: one key = one
 * mailbox = one loop. Each pass reads this inbox from its cursor forward and
 * acts on what came back; a pass that found human replies hands the fleet's
 * `Disposition` object a `classify` (when an LLM is configured), so the
 * operator's queue is labelled minutes after the reply lands rather than the
 * next time someone runs a command.
 *
 * A failed pass is asked again after one tick, not one sync interval (U-D10):
 * the cursor did not move, so nothing is skipped by asking soon — and not
 * sooner than a tick, so a mailbox that is down is asked once a minute rather
 * than as fast as it can refuse.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { DAY_MS, type InboxReader, type SyncStats, syncInbox } from "../inbox/sync.js";
import { DISPOSITION_KEY, type Disposition } from "./disposition.js";
import { makeLoopObject, runPass } from "./loop.js";

export interface InboxSchedulerDeps {
  db: Db;
  reader: InboxReader;
  /** The roster; a key off it still syncs (the mailbox may hold replies to old sends) but `status` says so. */
  senders: readonly string[];
  /** Between passes that returned (default 5 min). */
  syncMs?: number;
  /** After a pass that threw (default 1 min). */
  tickMs?: number;
  /** A mailbox's first sync reach (default 30 days). */
  firstSyncLookbackMs?: number;
  /** Classify after a pass that found replies. Off when no real LLM is configured. */
  classify?: boolean;
}

export const INBOX_SYNC_COMMAND = "outreach inbox sync";

export function makeInboxScheduler(deps: InboxSchedulerDeps) {
  const syncMs = deps.syncMs ?? 300_000;
  const tickMs = deps.tickMs ?? 60_000;
  const lookbackMs = deps.firstSyncLookbackMs ?? 30 * DAY_MS;

  return makeLoopObject("InboxScheduler", async (ctx: restate.ObjectContext) => {
    const sender = ctx.key;
    const now = new Date(await ctx.date.now());
    const outcome = await runPass<SyncStats>(ctx, deps.db, now, {
      name: "inbox sync",
      ledger: {
        command: INBOX_SYNC_COMMAND,
        argv: { daemon: true, senders: [sender], lookback_days: lookbackMs / DAY_MS },
      },
      body: (runId) =>
        syncInbox(deps.db, {
          reader: deps.reader,
          senders: [sender],
          now,
          runId,
          firstSyncLookbackMs: lookbackMs,
        }),
      delayAfter: () => syncMs,
      retryMs: tickMs,
    });
    if (deps.classify && (outcome.stats?.replies ?? 0) > 0) {
      ctx.objectSendClient<Disposition>({ name: "Disposition" }, DISPOSITION_KEY).classify();
    }
    return outcome;
  });
}

export type InboxScheduler = ReturnType<typeof makeInboxScheduler>;
