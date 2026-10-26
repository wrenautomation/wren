/** Enrichment handlers that search: the ad library, Exa and trigger events. */
import * as restate from "@restatedev/restate-sdk";
import { runScreen } from "@wren/core";
import { bucketOf } from "@wren/core/limits";
import { clientOfKey, exclusiveHandler } from "@wren/core/restate";
import {
  AD_LIBRARY_COMMAND,
  type AdLibraryStats,
  adKeywordsDue,
  adLibraryRoom,
  adLibraryUnit,
  countAdLibraryUnit,
  emptyAdLibraryStats,
} from "../enrichment/ad-library.js";
import {
  countExaSearchUnit,
  EXA_SEARCH_COMMAND,
  type ExaSearchStats,
  emptyExaSearchStats,
  exaSearches,
  exaSearchesDue,
  exaSearchRoom,
  exaSearchUnit,
} from "../enrichment/exa-search.js";
import {
  countTriggerUnit,
  emptyTriggersStats,
  TRIGGERS_COMMAND,
  type TriggersStats,
  triggersDue,
  triggersRoom,
  triggerUnit,
} from "../enrichment/news-triggers.js";
import { AD_LIBRARY_LIMIT, EXA_SEARCH_LIMIT, TRIGGERS_LIMIT } from "../limits.js";
import { type EnrichmentContext, HELD, LIMIT, type LimitInput } from "./enrichment-context.js";
import { notHeld, stageHolds } from "./units.js";

export function searchHandlers(enrich: EnrichmentContext) {
  const { deps, llmOf, fetcher, scope, open, close, unit } = enrich;
  return {
    adLibrary: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<AdLibraryStats> => {
        // The firms land on main: Wren's niches only.
        if (clientOfKey(ctx.key.split("@")[0] as string))
          throw new restate.TerminalError("Ad Library reads run on Wren's niches only");
        const desk = deps.desk;
        if (!desk) throw new restate.TerminalError("no desk client for fb-public");
        const { db, niche } = scope(ctx);
        if (niche === null) throw new restate.TerminalError("Ad Library reads need a niche key");
        const ads = deps.adsFor?.(niche) ?? null;
        const limit = input?.limit ?? 3;
        const runId = await open(ctx, AD_LIBRARY_COMMAND, { limit, niche });
        const plan = await ctx.run("select", async () => {
          const now = new Date();
          const { room, nextInMs } = await adLibraryRoom(
            db,
            now,
            await bucketOf(deps.db, null, AD_LIBRARY_LIMIT),
          );
          if (room === 0)
            return { why: `bucket empty: next read in ${Math.ceil(nextInMs / 1000)}s`, work: [] };
          const keywords = ads?.keywords ?? [];
          return {
            why: null,
            work: await adKeywordsDue(db, keywords, { now, limit: Math.min(limit, room) }),
          };
        });
        const stats = emptyAdLibraryStats();
        stats.selected = plan.work.length;
        stats.stopped = plan.why;
        const holds = await stageHolds(ctx, db, HELD.ads);
        for (const q of notHeld(holds, plan.work)) {
          const r = await unit(
            ctx,
            `ads ${q}`,
            () => adLibraryUnit(db, desk, { q, niche, platforms: ads?.platforms ?? [] }),
            { holds, id: q },
          );
          if (!r.ok) {
            stats.stopped = r.reason;
            break;
          }
          stats.stopped = countAdLibraryUnit(stats, r.value);
          if (stats.stopped) break;
        }
        // New firms get the niche's screen (chains, foreign, its own rule) before any stage reads them.
        const screen = ads?.screen;
        if (stats.created > 0 && screen)
          await ctx.run("screen", async () => {
            await runScreen(db, niche, screen);
          });
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    exaSearch: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<ExaSearchStats> => {
        // The firms land on main: Wren's niches only.
        if (clientOfKey(ctx.key.split("@")[0] as string))
          throw new restate.TerminalError("Exa searches run on Wren's niches only");
        const sites = deps.exaSites;
        if (!sites) throw new restate.TerminalError("no sites client for Exa search");
        const { db, niche } = scope(ctx);
        if (niche === null) throw new restate.TerminalError("Exa searches need a niche key");
        const exa = deps.exaFor?.(niche) ?? null;
        const limit = input?.limit ?? 3;
        const runId = await open(ctx, EXA_SEARCH_COMMAND, { limit, niche });
        const plan = await ctx.run("select", async () => {
          const now = new Date();
          const { room, nextInMs } = await exaSearchRoom(
            db,
            now,
            await bucketOf(deps.db, null, EXA_SEARCH_LIMIT),
          );
          if (room === 0)
            return {
              why: `bucket empty: next search in ${Math.ceil(nextInMs / 1000)}s`,
              work: [],
            };
          const searches = exaSearches(exa?.queries ?? [], exa?.cities ?? []);
          return {
            why: null,
            work: await exaSearchesDue(db, searches, { now, limit: Math.min(limit, room) }),
          };
        });
        const stats = emptyExaSearchStats();
        stats.selected = plan.work.length;
        stats.stopped = plan.why;
        const holds = await stageHolds(ctx, db, HELD.exa);
        for (const q of notHeld(holds, plan.work)) {
          const r = await unit(
            ctx,
            `exa ${q}`,
            () => exaSearchUnit(db, sites, { q, niche, platforms: exa?.platforms ?? [] }),
            { holds, id: q },
          );
          if (!r.ok) {
            stats.stopped = r.reason;
            break;
          }
          stats.stopped = countExaSearchUnit(stats, r.value);
          if (stats.stopped) break;
        }
        // New firms get the niche's screen (chains, foreign, its own rule) before any stage reads them.
        const screen = exa?.screen;
        if (stats.created > 0 && screen)
          await ctx.run("screen", async () => {
            await runScreen(db, niche, screen);
          });
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    /** News that makes a lead (designs/2026-10-10-triggers.md): each word's last two weeks. */
    triggers: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<TriggersStats> => {
        // The firms land on main: Wren's niches only.
        if (clientOfKey(ctx.key.split("@")[0] as string))
          throw new restate.TerminalError("trigger searches run on Wren's niches only");
        const { db, niche } = scope(ctx);
        if (niche === null) throw new restate.TerminalError("trigger searches need a niche key");
        const t = deps.triggersFor?.(niche) ?? null;
        const limit = input?.limit ?? 3;
        const runId = await open(ctx, TRIGGERS_COMMAND, { limit, niche });
        const now = new Date(await ctx.date.now());
        const plan = await ctx.run("select", async () => {
          const { room, nextInMs } = await triggersRoom(
            db,
            now,
            await bucketOf(deps.db, null, TRIGGERS_LIMIT),
          );
          if (room === 0)
            return {
              why: `bucket empty: next search in ${Math.ceil(nextInMs / 1000)}s`,
              work: [],
            };
          return {
            why: null,
            work: await triggersDue(db, t?.words ?? [], { now, limit: Math.min(limit, room) }),
          };
        });
        const stats = emptyTriggersStats();
        stats.selected = plan.work.length;
        stats.stopped = plan.why;
        const llm = llmOf(ctx, "triggers", runId);
        const holds = await stageHolds(ctx, db, HELD.triggers);
        for (const word of notHeld(holds, plan.work)) {
          const r = await unit(
            ctx,
            `triggers ${word}`,
            () => triggerUnit(db, { fetcher: fetcher(), llm }, { word, niche, now }),
            { holds, id: word },
          );
          if (!r.ok) {
            stats.stopped = r.reason;
            break;
          }
          countTriggerUnit(stats, r.value);
        }
        // New firms get the niche's screen (chains, foreign, its own rule) before any stage reads them.
        if (stats.created > 0 && t?.screen) {
          const screen = t.screen;
          await ctx.run("screen", async () => {
            await runScreen(db, niche, screen);
          });
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
  };
}
