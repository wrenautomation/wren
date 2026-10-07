/**
 * `SetupWatch/all`: once an hour, done setups whose repeat is due get every check again
 * (`recheck`). A fact that fails starts its setup over on the spine. Started by hand, like
 * every loop.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import type { Notifier } from "./notify.js";
import { makeLoopObject, type PassOutcome, runPass } from "./restate/loop.js";
import { recheck, type Setup, type SetupCheck, type SetupEmit } from "./setup.js";
import { spineEmit } from "./spine.js";

export const SETUP_WATCH_KEY = "all";
export const SETUP_WATCH_EVERY_MS = 3_600_000;

interface SetupWatchPass {
  checked: number;
  lost: number;
  emits: SetupEmit[];
}

export function makeSetupWatch(deps: {
  main: Db;
  setups: readonly Setup[];
  checks: Readonly<Record<string, SetupCheck>>;
  notifier?: Notifier;
}) {
  return makeLoopObject("SetupWatch", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const outcome = (await runPass<SetupWatchPass>(ctx, deps.main, now, {
      name: "recheck",
      ledger: { command: "setup watch", argv: { daemon: true } },
      body: () => recheck(deps.main, deps.setups, deps.checks, { now }),
      delayAfter: () => SETUP_WATCH_EVERY_MS,
      retryMs: SETUP_WATCH_EVERY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    })) as PassOutcome<SetupWatchPass>;
    for (const e of outcome.stats?.emits ?? []) spineEmit(ctx, e);
    return outcome;
  });
}

export type SetupWatch = ReturnType<typeof makeSetupWatch>;
