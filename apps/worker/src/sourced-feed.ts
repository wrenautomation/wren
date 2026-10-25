/**
 * `SourcedFeed/all`: a person added to a list that a live sourced source of the shape takes
 * people from is told to the spine as a `trigger.source` fire, and the shape opens a journey. A tail loop (like `Segments`): a cursor per workspace and list keeps it one fire per
 * member. Start it with `POST SourcedFeed/all/start`.
 */
import type * as restate from "@restatedev/restate-sdk";
import {
  clientKey,
  makeLoopObject,
  type PassOutcome,
  runPass,
  setLastPass,
} from "@wren/core/restate";
import { type Fired, spineFire } from "@wren/core/spine";
import type { Db } from "@wren/db";
import { type SourceCursors, sourcedPass } from "@wren/pipeline/sourced";

const SOURCED_FEED = { name: "SourcedFeed" } as const;
const CURSORS = "cursors";
/** Between two passes when a list has more members to read. */
const MORE_MS = 5_000;
/** Between two passes when caught up. */
const IDLE_MS = 5 * 60_000;
const PER_LIST = 200;

interface SourcedFeedDeps {
  main: Db;
  clientDb(id: string): Db;
  clients(): Promise<string[]>;
}

export interface FeedStats {
  scanned: number;
  fired: number;
  unkeyed: number;
  more: boolean;
}

/** The workspace's cursors: Wren's under `wren`, a client's under `clientKey`. */
type Cursors = Record<string, SourceCursors>;
const WREN = "wren";

export function makeSourcedFeed(d: SourcedFeedDeps) {
  return makeLoopObject(SOURCED_FEED.name, async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const had = (await ctx.get<Cursors>(CURSORS)) ?? {};
    const outcome = (await runPass<FeedStats & { fires: Fired[]; cursors: Cursors }>(
      ctx,
      d.main,
      now,
      {
        name: "sourced feed",
        ledger: { command: "journeys sourced", argv: { daemon: true } },
        body: async () => {
          const out: Cursors = { ...had };
          const all: Fired[] = [];
          const stats: FeedStats = { scanned: 0, fired: 0, unkeyed: 0, more: false };
          const spaces: [string, string | null][] = [
            [WREN, null],
            ...(await d.clients()).map((c): [string, string | null] => [clientKey(c, WREN), c]),
          ];
          for (const [key, client] of spaces) {
            const db = client ? d.clientDb(client) : d.main;
            const r = await sourcedPass(db, client, had[key] ?? {}, now, PER_LIST);
            out[key] = r.cursors;
            all.push(...r.fires);
            stats.scanned += r.scanned;
            stats.unkeyed += r.unkeyed;
            if (r.more) stats.more = true;
          }
          stats.fired = all.length;
          return { ...stats, fires: all, cursors: out };
        },
        delayAfter: (s) => (s.more ? MORE_MS : IDLE_MS),
        retryMs: IDLE_MS,
      },
    )) as PassOutcome<FeedStats & { fires: Fired[]; cursors: Cursors }>;
    if (outcome.stats) {
      for (const f of outcome.stats.fires) spineFire(ctx, f);
      ctx.set(CURSORS, outcome.stats.cursors);
      const { fires: _f, cursors: _c, ...lean } = outcome.stats;
      const kept: PassOutcome<FeedStats> = { ...outcome, stats: lean };
      await setLastPass(ctx, kept);
      return kept;
    }
    return outcome as PassOutcome<FeedStats>;
  });
}

export type SourcedFeed = ReturnType<typeof makeSourcedFeed>;
