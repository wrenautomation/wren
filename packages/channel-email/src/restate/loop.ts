/**
 * The shape every periodic stage shares: a Virtual Object whose key names the
 * unit of work (an inbox, or "fleet"), with `sync` (one pass now), `start`
 * (loop until stopped), `stop`, `loop` (one pass then a durable delay) and
 * `status`. The stage itself is one journaled step, and the step decides how
 * long until the next pass. Restate owns the timer, so a worker dying loses
 * nothing: the delayed call fires when the deployment is back.
 *
 * A stage failure is the stage's problem, not the loop's (U-D4): the step
 * catches it, records it on the ledger row and in `last`, and the loop asks
 * again after `retryMs` rather than dying or retrying as fast as it can.
 */
import * as restate from "@restatedev/restate-sdk";
import { type RunOptions, recordedRun } from "@wren/core";
import type { Db } from "@wren/db";
import type { Notifier } from "../notify.js";

const RUNNING = "running";
const LAST = "last";
export const MIN_DELAY_MS = 1_000;

/** What one pass left behind: its stats, or the error that ended it. */
export interface PassOutcome<S> {
  stats: S | null;
  error: string | null;
  /** When the next pass is due, ms after this pass's `now`. */
  delayMs: number;
  now: string;
}

export interface LoopStatus<S> {
  key: string;
  running: boolean;
  last: PassOutcome<S> | null;
}

export interface PassSpec<S extends object> {
  /** The journaled step's name and the ledger row it opens. */
  name: string;
  ledger: RunOptions;
  body: (runId: string) => Promise<S>;
  /** Delay after a pass that returned, given its stats. */
  delayAfter: (stats: S) => number;
  /** Delay after a pass that threw. */
  retryMs: number;
  /**
   * Told once when a pass starts failing (a new error text) and once when it
   * recovers; a stage that fails the same way every pass is one message, not one
   * per pass. Absent = silent.
   */
  notifier?: Notifier;
}

export function errorText(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, 300);
}

/**
 * Run one pass under a ledger row, inside one `ctx.run`. The step returns the
 * outcome rather than throwing: a stage that failed still needs its retry
 * delay journaled, and a thrown `ctx.run` would be retried by Restate's own
 * policy instead of ours.
 */
export async function runPass<S extends object>(
  ctx: restate.ObjectContext,
  db: Db,
  now: Date,
  spec: PassSpec<S>,
): Promise<PassOutcome<S>> {
  const result = await ctx.run(
    spec.name,
    async (): Promise<{ stats: S | null; error: string | null }> => {
      try {
        const { stats } = await recordedRun(db, spec.ledger, (run) => spec.body(run.id));
        return { stats, error: null };
      } catch (err) {
        return { stats: null, error: errorText(err) };
      }
    },
  );
  const delayMs = Math.max(
    result.stats === null ? spec.retryMs : spec.delayAfter(result.stats),
    MIN_DELAY_MS,
  );
  const outcome: PassOutcome<S> = { ...result, delayMs, now: now.toISOString() };
  const previous = (await ctx.get<PassOutcome<S>>(LAST)) ?? null;
  ctx.set(LAST, outcome);
  if (spec.notifier) await notifyErrorEdges(ctx, spec.notifier, spec.name, previous, outcome);
  return outcome;
}

/** The two edges worth a message: a new failure, and the recovery after one. */
async function notifyErrorEdges<S>(
  ctx: restate.ObjectContext,
  notifier: Notifier,
  stage: string,
  previous: PassOutcome<S> | null,
  outcome: PassOutcome<S>,
): Promise<void> {
  const where = `${stage} · ${ctx.key}`;
  const was = previous?.error ?? null;
  if (outcome.error !== null && outcome.error !== was) {
    await ctx.run("notify error", () =>
      notifier.notify(
        `${where} failed`,
        `${outcome.error}\nthe loop keeps trying every ${Math.round(outcome.delayMs / 60_000)} min; a repeat of the same error stays quiet`,
        "warning",
      ),
    );
  } else if (outcome.error === null && was !== null) {
    await ctx.run("notify recovered", () => notifier.notify(`${where} recovered`));
  }
}

/** The self-send a loop makes, typed by name: the definition's own type is not yet known inside its factory. */
type LoopSelf = { loop: (ctx: restate.ObjectContext) => Promise<void> };

/** The start/stop/loop/status handlers around one `pass`. */
export function makeLoopObject<S extends object>(
  name: string,
  pass: (ctx: restate.ObjectContext) => Promise<PassOutcome<S>>,
) {
  const self = (ctx: restate.ObjectContext) => ctx.objectSendClient<LoopSelf>({ name }, ctx.key);
  const object = restate.object({
    name,
    handlers: {
      /** One pass now; the loop (if any) is untouched. */
      sync: async (ctx: restate.ObjectContext): Promise<PassOutcome<S>> => pass(ctx),

      /** Begin looping; a no-op when already running. */
      start: async (ctx: restate.ObjectContext): Promise<LoopStatus<S>> => {
        const running = (await ctx.get<boolean>(RUNNING)) ?? false;
        if (!running) {
          ctx.set(RUNNING, true);
          self(ctx).loop();
        }
        return status(ctx, true);
      },

      /** The loop stops after the pass in flight, if any. */
      stop: async (ctx: restate.ObjectContext): Promise<LoopStatus<S>> => {
        ctx.set(RUNNING, false);
        return status(ctx, false);
      },

      /** One iteration: pass, then the next one after a durable delay. */
      loop: async (ctx: restate.ObjectContext): Promise<void> => {
        if (!((await ctx.get<boolean>(RUNNING)) ?? false)) return;
        const outcome = await pass(ctx);
        self(ctx).loop(restate.rpc.sendOpts({ delay: outcome.delayMs }));
      },

      status: restate.handlers.object.shared(
        async (ctx: restate.ObjectSharedContext): Promise<LoopStatus<S>> =>
          status(ctx, (await ctx.get<boolean>(RUNNING)) ?? false),
      ),
    },
  });

  async function status(
    ctx: restate.ObjectSharedContext | restate.ObjectContext,
    running: boolean,
  ): Promise<LoopStatus<S>> {
    return { key: ctx.key, running, last: (await ctx.get<PassOutcome<S>>(LAST)) ?? null };
  }

  return object;
}
