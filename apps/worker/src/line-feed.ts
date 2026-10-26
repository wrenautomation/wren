/**
 * `LineFeed/all`: Wren's content lines fed to the executor (designs/2026-10-25-ingestion-engine.md).
 * A document a line's find takes is told as a `trigger.found` fire and opens an instance; a job
 * that ends at a station is told as a `trigger.station` fire and moves it on. A tail loop (like
 * `SourcedFeed`), with no cursor: each pass reads what has not been told (`linePass`). Start it with
 * `POST LineFeed/all/start`.
 */
import type * as restate from "@restatedev/restate-sdk";
import { executorFire, type Fired } from "@wren/core/executor";
import { makeLoopObject, type PassOutcome, runPass, setLastPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { linePass } from "@wren/pipeline/lines";

const LINE_FEED = { name: "LineFeed" } as const;
/** Between two passes when a find has more documents to tell. */
const MORE_MS = 5_000;
/** Between two passes when caught up. */
const IDLE_MS = 5 * 60_000;
const PER_FIND = 200;

interface LineFeedDeps {
  main: Db;
}

interface LineStats {
  found: number;
  done: number;
  closed: number;
  more: boolean;
}

export function makeLineFeed(d: LineFeedDeps) {
  return makeLoopObject(LINE_FEED.name, async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const outcome = (await runPass<LineStats & { fires: Fired[] }>(ctx, d.main, now, {
      name: "line feed",
      ledger: { command: "lines feed", argv: { daemon: true } },
      body: () => linePass(d.main, now, PER_FIND),
      delayAfter: (s) => (s.more ? MORE_MS : IDLE_MS),
      retryMs: IDLE_MS,
    })) as PassOutcome<LineStats & { fires: Fired[] }>;
    if (outcome.stats) {
      for (const f of outcome.stats.fires) executorFire(ctx, f);
      const { fires: _f, ...lean } = outcome.stats;
      const kept: PassOutcome<LineStats> = { ...outcome, stats: lean };
      await setLastPass(ctx, kept);
      return kept;
    }
    return outcome as PassOutcome<LineStats>;
  });
}
