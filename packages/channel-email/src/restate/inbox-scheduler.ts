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
 *
 * A key's scope names the database its mailbox's replies land in and the
 * `Disposition` key that labels them: Wren's own, or its client's.
 */
import type * as restate from "@restatedev/restate-sdk";
import { type Notifier, plural } from "@wren/core/notify";
import { makeLoopObject, runPass, unitOfKey } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { SharedSuppressions } from "../guards.js";
import { DAY_MS, type InboxReader, type SyncStats, syncInbox } from "../inbox/sync.js";
import type { Disposition } from "./disposition.js";

/** Where one key's replies land, and which `Disposition` key labels them. */
export interface InboxScope {
  db: Db;
  disposition: string;
  /** A client's mailbox: its opt-outs and bounces also land on main's list. */
  shared?: SharedSuppressions | null;
}

export interface InboxSchedulerDeps {
  reader: InboxReader;
  /** From the key alone, so it needs no step: `acme/a@x.com` is acme's. */
  scopeOf: (key: string) => InboxScope;
  /** Between passes that returned (default 2 min). */
  syncMs?: number;
  /** After a pass that threw (default 1 min). */
  tickMs?: number;
  /** A mailbox's first sync reach (default 30 days). */
  firstSyncLookbackMs?: number;
  /** Classify after a pass that found replies. Off when no real LLM is configured. */
  classify?: boolean;
  /** Told the counts a pass found (replies; hard bounces and unsubscribes), never the text. */
  notifier?: Notifier;
}

export const INBOX_SYNC_COMMAND = "outreach inbox sync";

export function makeInboxScheduler(deps: InboxSchedulerDeps) {
  const syncMs = deps.syncMs ?? 120_000;
  const tickMs = deps.tickMs ?? 60_000;
  const lookbackMs = deps.firstSyncLookbackMs ?? 30 * DAY_MS;

  return makeLoopObject("InboxScheduler", async (ctx: restate.ObjectContext) => {
    const sender = unitOfKey(ctx.key);
    const scope = deps.scopeOf(ctx.key);
    const now = new Date(await ctx.date.now());
    const outcome = await runPass<SyncStats>(ctx, scope.db, now, {
      name: "inbox sync",
      ledger: {
        command: INBOX_SYNC_COMMAND,
        argv: { daemon: true, senders: [sender], lookback_days: lookbackMs / DAY_MS },
      },
      body: (runId) =>
        syncInbox(scope.db, {
          reader: deps.reader,
          senders: [sender],
          now,
          runId,
          firstSyncLookbackMs: lookbackMs,
          shared: scope.shared ?? null,
        }),
      delayAfter: () => syncMs,
      retryMs: tickMs,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
    if (deps.classify && (outcome.stats?.replies ?? 0) > 0) {
      ctx.objectSendClient<Disposition>({ name: "Disposition" }, scope.disposition).classify();
    }
    if (deps.notifier && outcome.stats) await tell(ctx, deps.notifier, sender, outcome.stats);
    return outcome;
  });
}

/** A pointer to the mailbox, not a mirror of it: counts only, journaled so a replay stays quiet. */
async function tell(
  ctx: restate.ObjectContext,
  notifier: Notifier,
  sender: string,
  stats: SyncStats,
): Promise<void> {
  if (stats.replies > 0) {
    await ctx.run("notify replies", () =>
      notifier.notify(
        `${plural(stats.replies, "new reply", "new replies")} in ${sender}`,
        "conversations are human-owned: answer from the inbox",
        "action",
      ),
    );
  }
  if (stats.bounces_hard > 0 || stats.unsubscribes > 0) {
    await ctx.run("notify bounces", () =>
      notifier.notify(
        `${plural(stats.bounces_hard, "hard bounce")}, ${plural(stats.unsubscribes, "unsubscribe")} via ${sender}`,
        "suppressed and stopped by the sync; the kill switch pauses a domain at 2% bounces",
        "warning",
      ),
    );
  }
}

export type InboxScheduler = ReturnType<typeof makeInboxScheduler>;
