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
 * again with a backoff (`retryDelayMs`: seconds first, capped at `retryMs`)
 * rather than dying or retrying as fast as it can.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { z } from "zod";
import type { Notifier } from "../notify.js";
import { type RunOptions, recordedRun } from "../runs.js";
import { exclusiveHandler, NO_INPUT, sharedHandler } from "./form.js";

const RUNNING = "running";
/**
 * Bumped by each `start` that begins a loop; every `loop` call carries the one it
 * was sent under. A stop then start inside one delay would otherwise leave the old
 * delayed call to fire beside the new one: two chains, twice the passes. A call
 * with none (sent before this existed) counts as 0.
 */
export const GENERATION = "generation";
/** Object state key holding the last pass outcome; `status` reads it. */
export const LAST = "last";
/** Object state key holding what `start` was last given; a pass reads it with `loopSettings`. */
const SETTINGS = "settings";
export const MIN_DELAY_MS = 1_000;
/** The first retry after a failed pass; each further failure in a row doubles it. */
export const FIRST_RETRY_MS = 15_000;

/** Delay after the `failures`-th failed pass in a row: 15s, 30s, 1m, ... up to `capMs`. */
export function retryDelayMs(failures: number, capMs: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.max(failures - 1, 0), capMs);
}

/** Failed passes in a row, this one included (0 when it succeeded). */
export async function failuresInARow(ctx: restate.ObjectContext, failed: boolean): Promise<number> {
  if (!failed) return 0;
  const previous = await ctx.get<PassOutcome<unknown>>(LAST);
  return (previous?.failures ?? 0) + 1;
}

/** What one pass left behind: its stats, or the error that ended it. */
export interface PassOutcome<S> {
  stats: S | null;
  error: string | null;
  /** Failed passes in a row, this one included; drives the retry backoff. */
  failures: number;
  /** When the next pass is due, ms after this pass's `now`. */
  delayMs: number;
  now: string;
  /** Set when the work is gone (a client off or removed): the loop stops itself, saying why. */
  stopped?: string;
}

export interface LoopStatus<S> {
  key: string;
  running: boolean;
  last: PassOutcome<S> | null;
  /** What `start` was last given for this key; null = defaults. */
  settings: Record<string, unknown> | null;
}

/** The settings `start` stored for this loop's key, or null. */
export async function loopSettings<T extends object>(
  ctx: restate.ObjectContext | restate.ObjectSharedContext,
): Promise<T | null> {
  return (await ctx.get<T>(SETTINGS)) ?? null;
}

export interface PassSpec<S extends object> {
  /** The journaled step's name and the ledger row it opens. */
  name: string;
  ledger: RunOptions;
  body: (runId: string) => Promise<S>;
  /** Delay after a pass that returned, given its stats. */
  delayAfter: (stats: S) => number;
  /** The longest delay after failed passes (the backoff's cap). */
  retryMs: number;
  /**
   * Told once when a pass starts failing (a new error text) and once when it
   * recovers; a stage that fails the same way every pass is one message, not one
   * per pass. Absent = silent.
   */
  notifier?: Notifier;
}

/**
 * The root cause, named by the query it broke when a driver wrapped it. Never the
 * SQL text or params: those hide the cause, and they change every pass, so the
 * same failure would read as a new one each time.
 */
export function errorText(err: unknown): string {
  let root = err;
  for (let depth = 0; depth < 5 && root instanceof Error && root.cause !== undefined; depth++) {
    root = root.cause;
  }
  const query = queryOf(err);
  const text =
    root === err && query !== null
      ? "query failed"
      : root instanceof Error
        ? `${root.name}: ${root.message}`
        : String(root);
  return (query === null ? text : `${query}: ${text}`).slice(0, 300);
}

/** `insert "runs"` for a driver error carrying its SQL; null otherwise. */
function queryOf(err: unknown): string | null {
  const q = (err as { query?: unknown } | null)?.query;
  if (typeof q !== "string") return null;
  const verb = q.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "query";
  const table = /\b(?:into|from|update)\s+("[^"]+"|\w+)/i.exec(q)?.[1];
  return table === undefined ? verb : `${verb} ${table}`;
}

/** "45 s" under a minute, else whole minutes: never "every 0 min". */
export function formatDelay(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
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
  const previous = (await ctx.get<PassOutcome<S>>(LAST)) ?? null;
  const failures = result.stats === null ? (previous?.failures ?? 0) + 1 : 0;
  const delayMs = Math.max(
    result.stats === null ? retryDelayMs(failures, spec.retryMs) : spec.delayAfter(result.stats),
    MIN_DELAY_MS,
  );
  const outcome: PassOutcome<S> = { ...result, failures, delayMs, now: now.toISOString() };
  ctx.set(LAST, outcome);
  if (spec.notifier) await notifyErrorEdges(ctx, spec.notifier, spec.name, previous, outcome);
  return outcome;
}

/** The two edges worth a message: a new failure, and the recovery after one. */
export async function notifyErrorEdges<S>(
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
        `${outcome.error}\nthe loop keeps trying every ${formatDelay(outcome.delayMs)}; a repeat of the same error stays quiet`,
        "warning",
      ),
    );
  } else if (outcome.error === null && was !== null) {
    await ctx.run("notify recovered", () => notifier.notify(`${where} recovered`));
  }
}

/** The self-send a loop makes, typed by name: the definition's own type is not yet known inside its factory. */
type LoopSelf = { loop: (ctx: restate.ObjectContext, generation?: number) => Promise<void> };

export interface LoopHooks {
  /** Runs inside `stop`, after the key is marked stopped: for what the loop started elsewhere. */
  onStop?: (ctx: restate.ObjectContext) => Promise<void>;
}

/** A loop's settings: any object (`{}` = back to defaults); none keeps the stored ones. */
const START_INPUT = z
  .record(z.string(), z.unknown())
  .nullish()
  .describe("Settings for this key; {} = back to defaults; empty keeps them");

/** The start/stop/loop/status handlers around one `pass`. */
export function makeLoopObject<S extends object>(
  name: string,
  pass: (ctx: restate.ObjectContext) => Promise<PassOutcome<S>>,
  hooks: LoopHooks = {},
) {
  const self = (ctx: restate.ObjectContext) => ctx.objectSendClient<LoopSelf>({ name }, ctx.key);
  const object = restate.object({
    name,
    handlers: {
      /** One pass now; the loop (if any) is untouched. */
      sync: exclusiveHandler(
        { input: NO_INPUT },
        async (ctx: restate.ObjectContext): Promise<PassOutcome<S>> => pass(ctx),
      ),

      /**
       * Begin looping; a no-op when already running. A body replaces this key's
       * settings (`{}` = back to defaults) and applies from the next pass; no body
       * keeps them.
       */
      start: exclusiveHandler(
        { input: START_INPUT },
        async (
          ctx: restate.ObjectContext,
          settings?: Record<string, unknown> | null,
        ): Promise<LoopStatus<S>> => {
          if (settings !== undefined && settings !== null) {
            if (Object.keys(settings).length > 0) ctx.set(SETTINGS, settings);
            else ctx.clear(SETTINGS);
          }
          const running = (await ctx.get<boolean>(RUNNING)) ?? false;
          if (!running) {
            const generation = ((await ctx.get<number>(GENERATION)) ?? 0) + 1;
            ctx.set(GENERATION, generation);
            ctx.set(RUNNING, true);
            self(ctx).loop(generation);
          }
          return status(ctx, true);
        },
      ),

      /** The loop stops after the pass in flight, if any. */
      stop: exclusiveHandler(
        { input: NO_INPUT },
        async (ctx: restate.ObjectContext): Promise<LoopStatus<S>> => {
          ctx.set(RUNNING, false);
          if (hooks.onStop) await hooks.onStop(ctx);
          return status(ctx, false);
        },
      ),

      /** One iteration: pass, then the next one after a durable delay. Only the loop itself sends it. */
      loop: exclusiveHandler(
        { ingressPrivate: true },
        async (ctx: restate.ObjectContext, generation?: number | null): Promise<void> => {
          if (!((await ctx.get<boolean>(RUNNING)) ?? false)) return;
          const current = (await ctx.get<number>(GENERATION)) ?? 0;
          // A call from before the last stop: its chain ended there.
          if ((generation ?? 0) !== current) return;
          const outcome = await pass(ctx);
          if (outcome.stopped !== undefined) ctx.set(RUNNING, false);
          else self(ctx).loop(current, restate.rpc.sendOpts({ delay: outcome.delayMs }));
        },
      ),

      status: sharedHandler(
        { input: NO_INPUT },
        async (ctx: restate.ObjectSharedContext): Promise<LoopStatus<S>> =>
          status(ctx, (await ctx.get<boolean>(RUNNING)) ?? false),
      ),
    },
  });

  async function status(
    ctx: restate.ObjectSharedContext | restate.ObjectContext,
    running: boolean,
  ): Promise<LoopStatus<S>> {
    return {
      key: ctx.key,
      running,
      last: (await ctx.get<PassOutcome<S>>(LAST)) ?? null,
      settings: await loopSettings(ctx),
    };
  }

  return object;
}
