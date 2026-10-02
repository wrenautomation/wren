/**
 * The send daemon as a Restate Virtual Object keyed by sender address.
 *
 * One key = one inbox = one loop: `start` flips the key to running and sends
 * itself a `loop`; every `loop` runs one tick (kill switches, reconcile, the
 * paced walk restricted to this inbox), then schedules the next `loop` with a
 * durable delay — the per-inbox gap after a send, the tick interval while
 * waiting, or straight to the next window open. Restate owns the timer, so a
 * worker dying (or a laptop closing) loses nothing: the delayed call fires
 * when the deployment is back. `tick` runs once without touching the loop.
 *
 * The tick body is one journaled step over its own transactions: a retry
 * after a crash re-runs `sendTick`, which is safe by construction (intent
 * before act; reconcile resolves the row a crash left behind).
 *
 * A key's scope says which database, rules and fleet it sends under. Wren's
 * own inboxes share one; a client's mailbox gets its client's. A key whose
 * scope is gone (the client stopped sending) stops its own loop.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import type { Calendar } from "@wren/core/calendar";
import { type Notifier, plural } from "@wren/core/notify";
import { unitOfKey } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { SendStats } from "../send/deliver.js";
import type { SendPolicy } from "../send/policy.js";
import { seededRng } from "../send/rng.js";
import { type Fleet, type KillSwitches, sendTick } from "../send/tick.js";
import type { Transport } from "../send/transport.js";

/** What one key sends under. */
export interface SendScope {
  db: Db;
  policy: SendPolicy;
  fleet: Fleet;
  pixelBaseUrl?: string | null;
  /** Where `{call.times}` finds open times; a client's scope has none. */
  calendar?: Calendar | null;
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

export interface TickOutcome {
  stats: SendStats;
  newPauses: number;
  /** When the next loop iteration is due, ms after this tick's `now`. */
  delayMs: number;
  now: string;
}

/** One scope for every key: a single fleet. */
export const oneScope =
  (scope: SendScope): ((key: string) => Promise<SendScope>) =>
  async () =>
    scope;

export interface SchedulerStatus {
  sender: string;
  running: boolean;
  onRoster: boolean;
  last: TickOutcome | null;
}

const RUNNING = "running";
const LAST = "last";
/** As in `makeLoopObject`: a stop then start never leaves two chains. */
const GENERATION = "generation";
const MIN_DELAY_MS = 1_000;

export function makeSendScheduler(deps: SendSchedulerDeps) {
  const tickMs = deps.tickMs ?? 60_000;
  const onRoster = (scope: SendScope | null, key: string) =>
    scope?.fleet.senders.some((s) => sameMailbox(s, key)) ?? false;

  /** One tick for this key's inbox, journaled as a single step; null = the scope is gone. */
  const runTick = async (ctx: restate.ObjectContext): Promise<TickOutcome | null> => {
    const key = ctx.key;
    const now = new Date(await ctx.date.now());
    // Drawn from the journal, not inside the step, so a retried step paces the same way.
    const seed = Math.floor(ctx.rand.random() * 0x100000000);
    // The scope is read inside the step: a database handle can't be journaled, and the delay needs its rules.
    const result = await ctx.run("send tick", async () => {
      const scope = await deps.scopeOf(key);
      if (!scope) return null;
      const fleet: Fleet = {
        ...scope.fleet,
        // Only this key's inbox may send here; the rest of the fleet has its own keys.
        senders: scope.fleet.senders.filter((s) => sameMailbox(s, key)),
      };
      const run = await openRun(scope.db, {
        command: "send tick",
        argv: { sender: unitOfKey(key) },
      });
      const { stats, newPauses, nextSendAt } = await sendTick(scope.db, {
        policy: scope.policy,
        transport: deps.transport,
        now,
        runId: run.id,
        fleet,
        pixelBaseUrl: scope.pixelBaseUrl ?? null,
        calendar: scope.calendar ?? null,
        rng: seededRng(seed),
        ...(deps.killSwitches ? { killSwitches: deps.killSwitches } : {}),
      });
      await finishRun(scope.db, run.id, stats);
      return {
        stats,
        newPauses: newPauses.length,
        paused: newPauses.map((p) => `${p.sender} — ${p.reason}`),
        delayMs: nextDelay(scope.policy, stats, now, nextSendAt, tickMs),
      };
    });
    if (!result) return null;
    const { paused, ...rest } = result;
    const outcome: TickOutcome = { ...rest, now: now.toISOString() };
    ctx.set(LAST, outcome);
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

  const scheduler = restate.object({
    name: "SendScheduler",
    handlers: {
      /** Run one tick now; the loop (if any) is untouched, unless the scope is gone: then it ends, as its own next tick would end it. */
      tick: async (ctx: restate.ObjectContext): Promise<TickOutcome | null> => {
        const outcome = await runTick(ctx);
        if (!outcome && ((await ctx.get<boolean>(RUNNING)) ?? false)) ctx.set(RUNNING, false);
        return outcome;
      },

      /** Begin looping; a no-op when already running. */
      start: async (ctx: restate.ObjectContext): Promise<SchedulerStatus> => {
        const running = (await ctx.get<boolean>(RUNNING)) ?? false;
        if (!running) {
          const generation = ((await ctx.get<number>(GENERATION)) ?? 0) + 1;
          ctx.set(GENERATION, generation);
          ctx.set(RUNNING, true);
          ctx.objectSendClient(scheduler, ctx.key).loop(generation);
        }
        return status(ctx, true);
      },

      /** The loop stops after the tick in flight, if any. */
      stop: async (ctx: restate.ObjectContext): Promise<SchedulerStatus> => {
        ctx.set(RUNNING, false);
        return status(ctx, false);
      },

      /** One iteration: tick, then the next one after a durable delay. */
      loop: async (ctx: restate.ObjectContext, generation?: number | null): Promise<void> => {
        if (!((await ctx.get<boolean>(RUNNING)) ?? false)) return;
        const current = (await ctx.get<number>(GENERATION)) ?? 0;
        // A call from before the last stop: its chain ended there.
        if ((generation ?? 0) !== current) return;
        const outcome = await runTick(ctx);
        if (!outcome) {
          ctx.set(RUNNING, false);
          return;
        }
        ctx
          .objectSendClient(scheduler, ctx.key)
          .loop(current, restate.rpc.sendOpts({ delay: outcome.delayMs }));
      },

      status: restate.handlers.object.shared(
        async (ctx: restate.ObjectSharedContext): Promise<SchedulerStatus> =>
          status(ctx, (await ctx.get<boolean>(RUNNING)) ?? false),
      ),
    },
  });

  async function status(
    ctx: restate.ObjectSharedContext | restate.ObjectContext,
    running: boolean,
  ): Promise<SchedulerStatus> {
    const listed = await ctx.run("on roster", async () =>
      onRoster(await deps.scopeOf(ctx.key), ctx.key),
    );
    return {
      sender: ctx.key,
      running,
      onRoster: listed,
      last: (await ctx.get<TickOutcome>(LAST)) ?? null,
    };
  }

  return scheduler;
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
