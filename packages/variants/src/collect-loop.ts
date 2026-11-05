/**
 * `VariantsCollect/all`: vireo's collect over wren's collectors every 6 hours,
 * so a post's daily metrics land within a quarter day. `wren variants collect` runs one pass.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { variants } from "./index.js";

const EVERY_MS = 6 * 3_600_000;

type Stats = Awaited<ReturnType<ReturnType<typeof variants>["collect"]>>;

export function makeVariantsCollect(deps: { db: Db; notifier?: Notifier }) {
  return makeLoopObject("VariantsCollect", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    return runPass<Stats>(ctx, deps.db, {
      now,
      name: "collect",
      ledger: { command: "variants collect", argv: { daemon: true } },
      body: () => variants(deps.db).collect(),
      delayAfter: () => EVERY_MS,
      retryMs: EVERY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    }) as Promise<PassOutcome<Stats>>;
  });
}
