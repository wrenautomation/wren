/**
 * The send daemon as a loop object (`makeLoopObject`) keyed by sender address.
 *
 * One key = one inbox = one loop: each `loop` runs one tick (kill switches, reconcile, the
 * paced walk restricted to this inbox), then schedules the next `loop` with a durable delay:
 * the per-inbox gap after a send, the tick interval while waiting, or straight to the next
 * window open. Restate owns the timer, so a worker dying (or a laptop closing) loses nothing.
 * `sync` runs one tick without touching the loop (`tick` too, its old name, until 2026-10-30).
 *
 * The state is the same `loop` key the object had before it moved here (`loopState`): a key
 * that was running stays running, and its queued `loop` call makes the next pass.
 *
 * The tick body is one journaled step over its own transactions: a retry after a crash re-runs
 * `sendTick`, which is safe by construction (intent before act; reconcile resolves the row a
 * crash left behind). A tick that keeps throwing fails after `TICK_TRIES` tries, and the loop
 * keeps it as a failed pass with a backoff (`passOrFailed`), never parked behind its retries.
 *
 * A key's scope says which database, rules and fleet it sends under. Wren's own inboxes share
 * one; a client's mailbox gets its client's. A key whose scope is gone (the client stopped
 * sending) stops its own loop.
 */

import type * as restate from "@restatedev/restate-sdk";
import { recordedRun } from "@wren/core";
import type { Calendar } from "@wren/core/calendar";
import { type Notifier, plural } from "@wren/core/notify";
import {
  clientOfKey,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
  unitOfKey,
} from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import type { Db } from "@wren/db";
import type { SharedSuppressions } from "../guards.js";
import type { SendStats } from "../send/deliver.js";
import type { SendPolicy } from "../send/policy.js";
import { seededRng } from "../send/rng.js";
import { type Fleet, type KillSwitches, sendTick, type TickResult } from "../send/tick.js";
import type { Transport } from "../send/transport.js";

/** What one key sends under. */
export interface SendScope {
  db: Db;
  policy: SendPolicy;
  fleet: Fleet;
  pixelBaseUrl?: string | null;
  /** Where `{call.times}` finds open times; a client's scope has none. */
  calendar?: Calendar | null;
  /** A client's scope: main's suppressions gate its sends too. */
  shared?: SharedSuppressions | null;
}

export interface SendSchedulerDeps {
  transport: Transport;
  /** This key's scope; null = nothing to send as any more, and the loop stops. */
  scopeOf: (key: string) => Promise<SendScope | null>;
  /** How long to wait between ticks that sent nothing inside the window. */
  tickMs?: number;
  killSwitches?: KillSwitches;
  /** Told when a tick's kill switch paused a domain. */
  notifier?: Notifier;
}

/** One tick's stats: the ledger row's counts, and how many inboxes its kill switch paused. */
export type TickStats = SendStats & { newPauses: number };
export type TickOutcome = PassOutcome<TickStats>;

/** One scope for every key: a single fleet. */
export const oneScope =
  (scope: SendScope): ((key: string) => Promise<SendScope>) =>
  async () =>
    scope;

const MIN_DELAY_MS = 1_000;
/** Tries of one tick's step before the pass fails (and the loop backs off). */
export const TICK_TRIES = 3;
export const SEND_TICK_COMMAND = "send tick";
export const NO_SCOPE = "no send scope for this key: sending is off or the mailbox is gone";

export function makeSendScheduler(deps: SendSchedulerDeps) {
  const tickMs = deps.tickMs ?? 60_000;

  /** One tick for this key's inbox, journaled as a single step; a key whose scope is gone stops. */
  const pass = async (ctx: restate.ObjectContext): Promise<TickOutcome> => {
    const key = ctx.key;
    const now = new Date(await ctx.date.now());
    // Drawn from the journal, not inside the step, so a retried step paces the same way.
    const seed = Math.floor(ctx.rand.random() * 0x100000000);
    // The scope is read inside the step: a database handle can't be journaled, and the delay needs its rules.
    const result = await ctx.run(
      SEND_TICK_COMMAND,
      async () => {
        const scope = await deps.scopeOf(key);
        if (!scope) return null;
        const fleet: Fleet = {
          ...scope.fleet,
          // Only this key's inbox may send here; the rest of the fleet has its own keys.
          senders: scope.fleet.senders.filter((s) => sameMailbox(s, key)),
        };
        // The ledger row keeps the counts; the rest rides out beside them.
        let tick: TickResult | undefined;
        const { stats } = await recordedRun(
          scope.db,
          { command: SEND_TICK_COMMAND, argv: { sender: unitOfKey(key) } },
          async (run) => {
            tick = await sendTick(scope.db, {
              policy: scope.policy,
              transport: deps.transport,
              now,
              runId: run.id,
              fleet,
              pixelBaseUrl: scope.pixelBaseUrl ?? null,
              calendar: scope.calendar ?? null,
              shared: scope.shared ?? null,
              rng: seededRng(seed),
              ...(deps.killSwitches ? { killSwitches: deps.killSwitches } : {}),
            });
            return tick.stats;
          },
        );
        if (!tick) throw new Error("send tick ran no tick");
        const { newPauses, nextSendAt, touches } = tick;
        return {
          stats: { ...stats, newPauses: newPauses.length },
          paused: newPauses.map((p) => `${p.sender} — ${p.reason}`),
          delayMs: nextDelay(scope.policy, stats, now, nextSendAt, tickMs),
          touches,
        };
      },
      { maxRetryAttempts: TICK_TRIES, initialRetryInterval: 1000 },
    );
    if (!result) return stoppedPass(ctx, now, NO_SCOPE);
    const { stats, paused, touches, delayMs } = result;
    // Each sent step leaves its node; the cadence's next touch lets the next step go (follow.ts).
    const client = clientOfKey(key)?.client ?? null;
    for (const t of touches)
      spineEmit(ctx, { client, workflow: t.workflow, from: t.from, events: [t.event] });
    const outcome: TickOutcome = {
      stats,
      error: null,
      failures: 0,
      delayMs,
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    const notifier = deps.notifier;
    if (notifier && paused.length > 0) {
      await ctx.run("notify pauses", () =>
        notifier.notify(
          `kill switch paused ${plural(paused.length, "inbox", "inboxes")}`,
          `${paused.join("\n")}\nonly \`wren email senders resume\` lifts a pause`,
          "warning",
        ),
      );
    }
    return outcome;
  };

  return makeLoopObject("SendScheduler", pass, {
    effect: "sends",
    // `tick` is the old name of `sync`, kept for calls queued before this change. Remove after 2026-10-30.
    syncAliases: ["tick"],
  });
}

const sameMailbox = (sender: string, key: string) =>
  sender.toLowerCase() === unitOfKey(key).toLowerCase();

/**
 * How long until this inbox should look again: until the gap allows the next
 * send (after a send or while waiting on the gap), straight
 * to the next window open when closed or when the inbox is at today's cap
 * (unless a send still awaits reconcile), else the tick interval.
 */
export function nextDelay(
  policy: SendPolicy,
  stats: SendStats,
  now: Date,
  nextSendAt: Date | null,
  tickMs: number,
): number {
  if (stats.window_closed > 0) {
    return Math.max(policy.nextWindowOpen(now).getTime() - now.getTime(), MIN_DELAY_MS);
  }
  if ((stats.sent > 0 || stats.gap_waiting > 0) && nextSendAt !== null) {
    return Math.max(nextSendAt.getTime() - now.getTime(), MIN_DELAY_MS);
  }
  if (stats.senders_capped > 0 && stats.reconcile_pending === 0) {
    const [, tomorrow] = policy.localDayBounds(now);
    return Math.max(policy.nextWindowOpen(tomorrow).getTime() - now.getTime(), MIN_DELAY_MS);
  }
  return Math.max(tickMs, MIN_DELAY_MS);
}

export type SendScheduler = ReturnType<typeof makeSendScheduler>;
