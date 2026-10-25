/**
 * Time limits on what a loop pass waits for (designs/2026-10-16-loop-watchdog.md). A Restate call
 * that Restate paused never answers, and a pass waiting on it holds its key's lock for good. So
 * every call a pass makes waits at most its limit:
 *
 * - `within` waits on a Restate call (a `Content` read, a desk or `sites` call). Past the limit
 *   it cancels the call (`keep` leaves a write running, since it may land), counts it on this
 *   pass (`last.timeouts`, which LoopWatch shows), and throws `CallTimeout`. That is a terminal
 *   error, so the pass's usual catch for a refused unit skips the unit and goes on.
 * - `limitedRun` is a `ctx.run` for outbound I/O (HTTP): each try ends at its limit, and after
 *   its tries the step fails terminally instead of retrying until Restate pauses the pass.
 * - `unitLimits` adds the strikes: a unit that times out `STRIKES` passes in a row is held in
 *   Checks' `unit_holds` (7 days, one more try, then a person), not tried forever.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Queryable } from "@wren/db";
import { hold, holdsOn, settle } from "../checks.js";

const MIN = 60_000;

/** The usual limits, by kind of call. A call site names its own when none fits. */
export const LIMITS = {
  /** One platform read through `Content` (an API, or the desk's browser). */
  read: 5 * MIN,
  /** A read that walks many posts or pages in one call. */
  batch: 10 * MIN,
  /** A post going up: the call keeps running past it (`keep`). */
  publish: 15 * MIN,
  /** One page in the desk's browser (a profile, a thread). */
  desk: 10 * MIN,
  /** A quick read off our own services (a queue's `take`, a status). */
  quick: 1 * MIN,
  /** One HTTP request inside a step. */
  http: 2 * MIN,
} as const;

/** A loop's own limits: `LIMITS` with any it overrides (tests shorten them). */
export type Limits = { [K in keyof typeof LIMITS]: number };
export const limitsWith = (over?: Partial<Limits>): Limits => ({ ...LIMITS, ...over });

/** Passes in a row a unit may time out before it is held. */
const STRIKES = 3;

/** One call a pass stopped waiting on. */
export interface TimedOut {
  /** What was called: `Content/metrics`. */
  call: string;
  /** What it was for: a post, a person, a platform; null when the call is the pass's own. */
  unit: string | null;
  ms: number;
  /** This timeout was its `STRIKES`th in a row: the unit is held now. */
  held?: boolean;
}

/** A call that gave no answer within its limit. Terminal: the unit is skipped, never retried in this pass. */
export class CallTimeout extends restate.TimeoutError {
  override name = "CallTimeout";
  constructor(
    readonly call: string,
    readonly ms: number,
    note?: string,
  ) {
    super();
    this.message = `${call} gave no answer in ${Math.round(ms / 1000)} s${note ? `; ${note}` : ""}`;
  }
}

/** Per invocation attempt, like `loopState`: a replay rebuilds it from the journal. */
const tallies = new WeakMap<object, TimedOut[]>();

/** The calls this pass stopped waiting on so far; `setLastPass` keeps them as `last.timeouts`. */
export const timeoutsOf = (ctx: object): TimedOut[] => tallies.get(ctx) ?? [];

function tally(ctx: object, t: TimedOut): void {
  tallies.set(ctx, [...timeoutsOf(ctx), t]);
}

type Waitable<T> = restate.RestatePromise<T> &
  Partial<Pick<restate.InvocationHandle, "invocationId">>;

interface WithinOpts {
  ms: number;
  /** What is called, for the stat and the error: `Content/metrics`. */
  call: string;
  unit?: string | null;
  /** Leave the call running past the limit (a write that may still land). Default: cancel it. */
  keep?: boolean;
  /** Said after the error's text (a note for the reader). */
  note?: string;
}

/**
 * Wait on `p` at most `o.ms`. Past it the call is cancelled (unless `keep`), counted on the pass,
 * and `CallTimeout` thrown.
 */
export async function within<T>(ctx: restate.Context, p: Waitable<T>, o: WithinOpts): Promise<T> {
  try {
    return await p.orTimeout(o.ms);
  } catch (err) {
    if (!(err instanceof restate.TimeoutError) || err instanceof CallTimeout) throw err;
    if (!o.keep && p.invocationId) ctx.invocation(await p.invocationId).cancel();
    tally(ctx, { call: o.call, unit: o.unit ?? null, ms: o.ms });
    throw new CallTimeout(o.call, o.ms, o.note);
  }
}

const RUN_TIMEOUT = "no answer within ";

interface LimitedRunOpts {
  /** Each try's limit. */
  ms: number;
  /** Tries before the step fails terminally (default 3). */
  tries?: number;
  unit?: string | null;
}

/**
 * A `ctx.run` for outbound I/O. Each try is cut at `o.ms` (`signal` aborts a fetch that honors
 * it); after `tries` the step fails terminally. A step whose last try timed out is counted on
 * the pass and thrown as `CallTimeout`; any other failure is the step's own terminal error.
 */
export async function limitedRun<T>(
  ctx: restate.Context,
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
  o: LimitedRunOpts,
): Promise<T> {
  try {
    return await ctx.run(
      name,
      () => {
        const ac = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limit = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            ac.abort();
            reject(new Error(`${RUN_TIMEOUT}${Math.round(o.ms / 1000)} s`));
          }, o.ms);
        });
        return Promise.race([fn(ac.signal), limit]).finally(() => clearTimeout(timer));
      },
      { maxRetryAttempts: o.tries ?? 3, initialRetryInterval: 1000 },
    );
  } catch (err) {
    if (err instanceof restate.TerminalError && err.message.includes(RUN_TIMEOUT)) {
      tally(ctx, { call: name, unit: o.unit ?? null, ms: o.ms });
      throw new CallTimeout(name, o.ms);
    }
    throw err;
  }
}

/** Object state: each unit's timeouts in a row, by subject. */
const STRIKES_KEY = "strikes";
/** A strike older than this is dropped: the unit left the pass's work. */
const STRIKE_TTL_MS = 7 * 24 * 60 * MIN;

interface Strike {
  n: number;
  at: number;
}

/**
 * A loop's units under time limits. A unit may sit in a group (its platform): a group that times
 * out twice in a pass is left out for the rest of it, and a unit's timeout counts against the
 * unit only once its group answered something else in the pass. Else a platform that is down
 * would get its posts held one by one.
 */
export interface UnitLimits {
  /** The `unit_holds` stage: `loop.<service>/<key>`. */
  stage: string;
  /** Left out of this pass: the unit is held, or its group already timed out twice. */
  skip(unit: string, group?: string): boolean;
  /** `within` for one unit: its strikes counted, its hold settled when it answers its one retry. */
  within<T>(unit: string, p: Waitable<T>, o: UnitWithinOpts): Promise<T>;
  /**
   * The same for work whose calls carry their own limit (a `restateSites` client with
   * `limitMs`): a `CallTimeout` out of `fn` is the unit's strike.
   */
  guard<T>(unit: string, fn: () => Promise<T>, group?: string): Promise<T>;
}

interface UnitWithinOpts extends Omit<WithinOpts, "unit"> {
  group?: string;
}

/** `ContentMetrics` → `content-metrics`. */
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** The stage a loop's held units go under: `loop.content-metrics/default`. */
export const limitStage = (service: string, key: string) => `loop.${kebab(service)}/${key}`;

/**
 * The time limits for one pass of `service` on this key. One read of its holds a pass. A unit
 * that answers ends its strikes (and its hold, on its one retry); a unit due its retry that times
 * out again waits for a person.
 */
export async function unitLimits(
  ctx: restate.ObjectContext,
  db: Queryable,
  service: string,
): Promise<UnitLimits> {
  const stage = limitStage(service, ctx.key);
  const h = await ctx.run(`holds ${stage}`, () => holdsOn(db, stage));
  const held = new Set(h.held);
  const due = new Set(h.due);
  const now = await ctx.date.now();
  const strikes: Record<string, Strike> = {};
  for (const [k, s] of Object.entries((await ctx.get<Record<string, Strike>>(STRIKES_KEY)) ?? {}))
    if (now - s.at < STRIKE_TTL_MS) strikes[k] = s;
  const save = () => ctx.set(STRIKES_KEY, strikes);
  /** Groups that answered this pass, groups left out, and each group's timeouts not yet blamed. */
  const answered = new Set<string>();
  const slow = new Set<string>();
  const suspects = new Map<string, { unit: string; err: CallTimeout; t: TimedOut | undefined }>();

  async function strike(unit: string, err: CallTimeout, t: TimedOut | undefined) {
    const n = (strikes[unit]?.n ?? 0) + 1;
    const spent = due.has(unit);
    if (spent || n >= STRIKES) {
      delete strikes[unit];
      held.add(unit);
      await ctx.run(`hold ${unit}`, () =>
        hold(db, {
          stage,
          subject: unit,
          reason: `${err.call} gave no answer in ${Math.round(err.ms / 1000)} s, ${spent ? "again after its hold" : `${n} passes in a row`}`,
          spent,
        }),
      );
      if (t) t.held = true;
    } else strikes[unit] = { n, at: now };
    save();
  }

  async function answer(unit: string, group: string | undefined) {
    if (strikes[unit]) {
      delete strikes[unit];
      save();
    }
    if (group === undefined) return;
    answered.add(group);
    // The group is up: a timeout before this answer was its unit's own.
    const s = suspects.get(group);
    suspects.delete(group);
    if (s) await strike(s.unit, s.err, s.t);
  }

  async function guard<T>(unit: string, fn: () => Promise<T>, group?: string): Promise<T> {
    const before = timeoutsOf(ctx).length;
    try {
      const out = await fn();
      await answer(unit, group);
      if (due.has(unit)) {
        due.delete(unit);
        await ctx.run(`settle ${unit}`, () => settle(db, stage, [unit]));
      }
      return out;
    } catch (err) {
      if (!(err instanceof CallTimeout)) {
        // It answered, if only with a no.
        await answer(unit, group);
        throw err;
      }
      // The call's own limit counted it: it is this unit's.
      const t = timeoutsOf(ctx).slice(before).at(-1);
      if (t && t.unit === null) t.unit = unit;
      if (group === undefined || answered.has(group)) await strike(unit, err, t);
      else if (suspects.has(group)) {
        // Two in a row and nothing answered: the group is down, not these units.
        suspects.delete(group);
        slow.add(group);
      } else suspects.set(group, { unit, err, t });
      throw err;
    }
  }

  return {
    stage,
    skip: (unit, group) => held.has(unit) || (group !== undefined && slow.has(group)),
    within: (unit, p, o) => guard(unit, () => within(ctx, p, { ...o, unit }), o.group),
    guard,
  };
}
