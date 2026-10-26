/**
 * `PainFeed/all`: the pain points line (designs/2026-10-25-ingestion-engine.md, phase 3). Each
 * pass reads the reach posts kept since the cursor for a pain the author states, with a quote in
 * the post as proof; each pain is a finding on the post and a `trigger.source` fire for the
 * author's profile at the line's list, so the shape's sourced source opens their journey on the
 * outreach line. Wren only. Start it with `POST PainFeed/all/start`.
 */
import type * as restate from "@restatedev/restate-sdk";
import { executorFire, type Fired } from "@wren/core/executor";
import { makeLoopObject, type PassOutcome, runPass, setLastPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { painPass } from "@wren/outreach/pain";
import { liveSources } from "@wren/pipeline/sourced";

const PAIN_FEED = { name: "PainFeed" } as const;
const CURSOR = "cursor";
/** Between two passes while there are more posts to read. */
const MORE_MS = 5_000;
/** Between two passes when caught up. */
const IDLE_MS = 5 * 60_000;
const PER_PASS = 50;

interface PainFeedDeps {
  main: Db;
  llm: LlmClient;
}

export interface PainStats {
  scanned: number;
  read: number;
  pains: number;
  unproven: number;
  fired: number;
  waiting: boolean;
  more: boolean;
}

export function makePainFeed(d: PainFeedDeps) {
  return makeLoopObject(PAIN_FEED.name, async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const had = (await ctx.get<number>(CURSOR)) ?? 0;
    const outcome = (await runPass<PainStats & { fires: Fired[]; cursor: number }>(
      ctx,
      d.main,
      now,
      {
        name: "pain feed",
        ledger: { command: "journeys pain", argv: { daemon: true } },
        body: async () => {
          const r = await painPass(d.main, d.llm, await liveSources(d.main), had, now, PER_PASS);
          return {
            scanned: r.scanned,
            read: r.read,
            pains: r.pains,
            unproven: r.unproven,
            fired: r.fires.length,
            waiting: r.waiting,
            more: r.more,
            fires: r.fires,
            cursor: r.cursor,
          };
        },
        delayAfter: (s) => (s.more ? MORE_MS : IDLE_MS),
        retryMs: IDLE_MS,
      },
    )) as PassOutcome<PainStats & { fires: Fired[]; cursor: number }>;
    if (outcome.stats) {
      for (const f of outcome.stats.fires) executorFire(ctx, f);
      ctx.set(CURSOR, outcome.stats.cursor);
      const { fires: _f, cursor: _c, ...lean } = outcome.stats;
      const kept: PassOutcome<PainStats> = { ...outcome, stats: lean };
      await setLastPass(ctx, kept);
      return kept;
    }
    return outcome as PassOutcome<PainStats>;
  });
}

export type PainFeed = ReturnType<typeof makePainFeed>;
