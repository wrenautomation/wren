/**
 * `SetupRecheck/all`: once an hour, done setups whose repeat is due get every check again
 * (`recheck`). A fact that fails starts its setup over on the executor and pauses the parts that
 * need it. A run past its step's `within` that no round will catch turns stuck (`sweepStuck`).
 * Then the team hears each new alert once (`tellAlerts`) and, once a day, what's still open
 * (`digestAlerts`). Started by hand, like every loop.
 *
 * Reads only, outside Wren's own tables and lanes: the checks are free vendor reads, and nothing
 * here sends to a lead or a client, buys, or creates an account. The agent is never queued here.
 */

import type { Db } from "@wren/db";
import type * as restate from "@wren/runtime";
import { executorEmit } from "./executor.js";
import type { Notifier } from "./notify.js";
import { makeLoopObject, type PassOutcome, runPass } from "./restate/loop.js";
import { recheck, type Setup, type SetupCheck, type SetupEmit, sweepStuck } from "./setup.js";
import { type AlertPart, digestAlerts, tellAlerts } from "./setup-alerts.js";

const SETUP_WATCH_EVERY_MS = 3_600_000;

interface SetupRecheckPass {
  checked: number;
  lost: number;
  stuck: number;
  told: number;
  digests: number;
  emits: SetupEmit[];
}

interface SetupRecheckDeps {
  main: Db;
  setups: readonly Setup[];
  checks: Readonly<Record<string, SetupCheck>>;
  /** Parts that need facts: a lost one pauses them. */
  parts?: readonly AlertPart[];
  /** The team's lane per owner (null: Wren's own); none: alerts wait on Now alone. */
  notifierFor?: (client: string | null) => Notifier | null;
  /** The loop's own failures. */
  notifier?: Notifier;
}

/** One pass: recheck, sweep, tell, digest. Exported for tests and the CLI. */
export async function setupWatchPass(deps: SetupRecheckDeps, now: Date): Promise<SetupRecheckPass> {
  const r = await recheck(deps.main, deps.setups, deps.checks, {
    now,
    ...(deps.parts ? { parts: deps.parts } : {}),
  });
  const stuck = await sweepStuck(deps.main, deps.setups, now);
  const told = await tellAlerts(deps.main, deps.notifierFor, now);
  const digests = await digestAlerts(deps.main, deps.notifierFor, now);
  return { ...r, stuck, told, digests };
}

export function makeSetupRecheck(deps: SetupRecheckDeps) {
  return makeLoopObject("SetupRecheck", async (ctx: restate.ObjectContext) => {
    const outcome = (await runPass<SetupRecheckPass>(ctx, deps.main, {
      name: "recheck",
      ledger: { command: "setup watch", argv: { daemon: true } },
      body: (_runId, now) => setupWatchPass(deps, now),
      delayAfter: () => SETUP_WATCH_EVERY_MS,
      retryMs: SETUP_WATCH_EVERY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    })) as PassOutcome<SetupRecheckPass>;
    for (const e of outcome.stats?.emits ?? []) executorEmit(ctx, e);
    return outcome;
  });
}

export type SetupRecheck = ReturnType<typeof makeSetupRecheck>;
