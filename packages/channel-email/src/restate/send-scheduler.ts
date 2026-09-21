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
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { type Notifier, plural } from "@wren/core/notify";
import type { Db } from "@wren/db";
import type { SendStats } from "../send/deliver.js";
import type { SendPolicy } from "../send/policy.js";
import { seededRng } from "../send/rng.js";
import { type Fleet, type KillSwitches, sendTick } from "../send/tick.js";
import type { Transport } from "../send/transport.js";

export interface SendSchedulerDeps {
  db: Db;
  transport: Transport;
  policy: SendPolicy;
  fleet: Fleet;
  pixelBaseUrl?: string | null;
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

export interface SchedulerStatus {
  sender: string;
  running: boolean;
  onRoster: boolean;
  last: TickOutcome | null;
}

const RUNNING = "running";
const LAST = "last";
const MIN_DELAY_MS = 1_000;

export function makeSendScheduler(deps: SendSchedulerDeps) {
  const tickMs = deps.tickMs ?? 60_000;
  const onRoster = (sender: string) =>
    deps.fleet.senders.some((s) => s.toLowerCase() === sender.toLowerCase());

  /** One tick for this key's inbox, journaled as a single step. */
  const runTick = async (ctx: restate.ObjectContext): Promise<TickOutcome> => {
    const sender = ctx.key;
    const now = new Date(await ctx.date.now());
    // Drawn from the journal, not inside the step, so a retried step paces the same way.
    const seed = Math.floor(ctx.rand.random() * 0x100000000);
    const fleet: Fleet = {
      ...deps.fleet,
      // Only this key's inbox may send here; the rest of the fleet has its own keys.
      senders: deps.fleet.senders.filter((s) => s.toLowerCase() === sender.toLowerCase()),
    };
    const result = await ctx.run("send tick", async () => {
      const run = await openRun(deps.db, { command: "send tick", argv: { sender } });
      const { stats, newPauses } = await sendTick(deps.db, {
        policy: deps.policy,
        transport: deps.transport,
        now,
        runId: run.id,
        fleet,
        pixelBaseUrl: deps.pixelBaseUrl ?? null,
        rng: seededRng(seed),
        ...(deps.killSwitches ? { killSwitches: deps.killSwitches } : {}),
      });
      await finishRun(deps.db, run.id, stats);
      return {
        stats,
        newPauses: newPauses.length,
        paused: newPauses.map((p) => `${p.sender} — ${p.reason}`),
      };
    });
    const delayMs = nextDelay(deps.policy, result.stats, now, seed, tickMs);
    const { paused, ...rest } = result;
    const outcome: TickOutcome = { ...rest, delayMs, now: now.toISOString() };
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
      /** Run one tick now; the loop (if any) is untouched. */
      tick: async (ctx: restate.ObjectContext): Promise<TickOutcome> => runTick(ctx),

      /** Begin looping; a no-op when already running. */
      start: async (ctx: restate.ObjectContext): Promise<SchedulerStatus> => {
        const running = (await ctx.get<boolean>(RUNNING)) ?? false;
        if (!running) {
          ctx.set(RUNNING, true);
          ctx.objectSendClient(scheduler, ctx.key).loop();
        }
        return status(ctx, true);
      },

      /** The loop stops after the tick in flight, if any. */
      stop: async (ctx: restate.ObjectContext): Promise<SchedulerStatus> => {
        ctx.set(RUNNING, false);
        return status(ctx, false);
      },

      /** One iteration: tick, then the next one after a durable delay. */
      loop: async (ctx: restate.ObjectContext): Promise<void> => {
        if (!((await ctx.get<boolean>(RUNNING)) ?? false)) return;
        const outcome = await runTick(ctx);
        ctx
          .objectSendClient(scheduler, ctx.key)
          .loop(restate.rpc.sendOpts({ delay: outcome.delayMs }));
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
    return {
      sender: ctx.key,
      running,
      onRoster: onRoster(ctx.key),
      last: (await ctx.get<TickOutcome>(LAST)) ?? null,
    };
  }

  return scheduler;
}

/**
 * How long until this inbox should look again: the gap after a send, straight
 * to the next window open when closed, else the tick interval.
 */
export function nextDelay(
  policy: SendPolicy,
  stats: SendStats,
  now: Date,
  seed: number,
  tickMs: number,
): number {
  if (stats.window_closed > 0) {
    return Math.max(policy.nextWindowOpen(now).getTime() - now.getTime(), MIN_DELAY_MS);
  }
  if (stats.sent > 0) return Math.max(policy.gapFor(seededRng(seed)), MIN_DELAY_MS);
  return Math.max(tickMs, MIN_DELAY_MS);
}

export type SendScheduler = ReturnType<typeof makeSendScheduler>;
