/** Enrichment handlers that read YouTube, Instagram and Facebook groups. */
import * as restate from "@restatedev/restate-sdk";
import { runScreen } from "@wren/core";
import { clientOfKey, exclusiveHandler } from "@wren/core/restate";
import type { Queryable } from "@wren/db";
import { SOCIAL, socialSettingsSchema } from "../components.js";
import {
  countFbGroupsUnit,
  emptyFbGroupsStats,
  FB_GROUPS_COMMAND,
  type FbGroupsStats,
  groupAboutUnit,
  groupKeywordsDue,
  groupPostUnit,
  groupReadRoom,
  groupReadsDue,
  groupSearchRoom,
  groupSearchUnit,
  mapPosts,
} from "../enrichment/fb-groups.js";
import {
  countInstagramUnit,
  emptyInstagramStats,
  INSTAGRAM_COMMAND,
  INSTAGRAM_MIN_BATCH,
  type InstagramStats,
  instagramRoom,
  instagramUnit,
  instagramWork,
} from "../enrichment/instagram.js";
import {
  countYouTubeUnit,
  emptyYouTubeStats,
  YOUTUBE_COMMAND,
  YOUTUBE_MIN_BATCH,
  type YouTubeStats,
  youtubeReadRoom,
  youtubeUnit,
  youtubeWork,
} from "../enrichment/youtube.js";
import {
  countYouTubeSearchUnit,
  emptyYouTubeSearchStats,
  YOUTUBE_SEARCH_COMMAND,
  type YouTubeSearchStats,
  youtubeSearchesDue,
  youtubeSearchRoom,
  youtubeSearchUnit,
} from "../enrichment/youtube-search.js";
import {
  clientBlock,
  type EnrichmentContext,
  HELD,
  LIMIT,
  type LimitInput,
  UNIT_RETRY,
} from "./enrichment-context.js";
import { notHeld, stageHolds, unitBatches } from "./units.js";

/** A client key's social block says this network is on; Wren's keys always read. */
async function socialOn(main: Queryable, key: string, network: "youtube" | "instagram") {
  const got = await clientBlock(main, key, SOCIAL);
  if (!got) return null;
  const parsed = socialSettingsSchema.safeParse(got.block);
  if (!parsed.success) throw new restate.TerminalError(`${SOCIAL} settings do not parse`);
  if (!parsed.data[network]) throw new restate.TerminalError(`${network} is off for ${got.client}`);
  return got.client;
}

export function socialHandlers(enrich: EnrichmentContext) {
  const { deps, youtubeFor, scope, open, close, unit } = enrich;
  return {
    youtube: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<YouTubeStats> => {
        // A client's key reads its own firms into its own database, when its block has it on.
        const client = await ctx.run("client", () => socialOn(deps.db, ctx.key, "youtube"));
        const get = deps.youtube;
        if (!get)
          throw new restate.TerminalError("no YouTube reader (WREN_GOOGLE_SERVICE_ACCOUNT)");
        const { db, niche } = scope(ctx);
        if (niche === null && client === null)
          throw new restate.TerminalError("YouTube reads need a niche key");
        const limit = input?.limit ?? 20;
        const runId = await open(ctx, YOUTUBE_COMMAND, { limit, niche });
        const yt = client === null ? get : youtubeFor(client, get, "research.youtube", runId);
        const plan = await ctx.run("select", async () => {
          const { room, nextInMs } = await youtubeReadRoom(db, deps.db, client, new Date());
          if (room < Math.min(limit, YOUTUBE_MIN_BATCH))
            return {
              why: `bucket low (${room} reads): next in ${Math.ceil(nextInMs / 1000)}s`,
              work: [],
            };
          return {
            why: null,
            work: await youtubeWork(db, { niche, limit: Math.min(limit, room) }),
          };
        });
        const stats = emptyYouTubeStats();
        stats.selected = plan.work.length;
        stats.stopped = plan.why;
        const byId = new Map(plan.work.map((w) => [w.companyId, w]));
        const streak = { errors: 0 };
        // Free reads, so they batch: a crash re-reads at most one batch. A unit that throws
        // the same way every time counts as an error after its retries, never blocks the pool.
        const holds = await stageHolds(ctx, db, HELD.youtube);
        for await (const r of unitBatches(
          ctx,
          "youtube",
          notHeld(holds, [...byId.keys()]),
          (id) => youtubeUnit(db, yt, byId.get(id) as (typeof plan.work)[number]),
          { retry: UNIT_RETRY, holds },
        )) {
          const u = r.ok
            ? r.value
            : { companyId: r.id, outcome: "error" as const, uploads: 0, error: r.reason };
          stats.stopped = countYouTubeUnit(stats, u, streak);
          if (stats.stopped) break;
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    instagram: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<InstagramStats> => {
        // A client's key reads its own firms into its own database, when its block has it on.
        const client = await ctx.run("client", () => socialOn(deps.db, ctx.key, "instagram"));
        const sites = deps.instagram;
        if (!sites) throw new restate.TerminalError("no sites client for Instagram");
        const { db, niche } = scope(ctx);
        if (niche === null && client === null)
          throw new restate.TerminalError("Instagram reads need a niche key");
        const limit = input?.limit ?? 30;
        const runId = await open(ctx, INSTAGRAM_COMMAND, { limit, niche });
        const plan = await ctx.run("select", async () => {
          const { room, nextInMs } = await instagramRoom(
            db,
            new Date(),
            undefined,
            client === null ? null : deps.db,
          );
          if (room < Math.min(limit, INSTAGRAM_MIN_BATCH))
            return {
              why: `bucket low (${room} reads): next in ${Math.ceil(nextInMs / 1000)}s`,
              work: [],
            };
          return {
            why: null,
            work: await instagramWork(db, { niche, limit: Math.min(limit, room) }),
          };
        });
        const stats = emptyInstagramStats();
        stats.selected = plan.work.length;
        stats.stopped = plan.why;
        const byId = new Map(plan.work.map((w) => [w.companyId, w]));
        const streak = { errors: 0 };
        // A read is spent whether it worked or not, so a unit never throws (it answers an error
        // as data); a crash re-reads at most one batch.
        const holds = await stageHolds(ctx, db, HELD.instagram);
        for await (const r of unitBatches(
          ctx,
          "instagram",
          notHeld(holds, [...byId.keys()]),
          (id) => instagramUnit(db, sites, byId.get(id) as (typeof plan.work)[number]),
          { retry: UNIT_RETRY, holds },
        )) {
          const u = r.ok
            ? r.value
            : { companyId: r.id, outcome: "error" as const, posts: 0, error: r.reason };
          stats.stopped = countInstagramUnit(stats, u, streak);
          if (stats.stopped) break;
        }
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    youtubeSearch: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<YouTubeSearchStats> => {
        // The firms land on main: Wren's niches only.
        if (clientOfKey(ctx.key.split("@")[0] as string))
          throw new restate.TerminalError("YouTube searches run on Wren's niches only");
        const get = deps.youtube;
        if (!get) throw new restate.TerminalError("no YouTube reader for channel search");
        const { db, niche } = scope(ctx);
        if (niche === null) throw new restate.TerminalError("YouTube searches need a niche key");
        const yt = deps.youtubeSearchFor?.(niche) ?? null;
        const limit = input?.limit ?? 2;
        const runId = await open(ctx, YOUTUBE_SEARCH_COMMAND, { limit, niche });
        const plan = await ctx.run("select", async () => {
          const now = new Date();
          const { room, nextInMs } = await youtubeSearchRoom(db, now);
          if (room === 0)
            return {
              why: `bucket empty: next search in ${Math.ceil(nextInMs / 1000)}s`,
              work: [],
            };
          return {
            why: null,
            work: await youtubeSearchesDue(db, yt?.queries ?? [], {
              now,
              limit: Math.min(limit, room),
            }),
          };
        });
        const stats = emptyYouTubeSearchStats();
        stats.selected = plan.work.length;
        stats.stopped = plan.why;
        const holds = await stageHolds(ctx, db, HELD.youtubeSearch);
        for (const q of notHeld(holds, plan.work)) {
          const r = await unit(
            ctx,
            `youtube search ${q}`,
            () => youtubeSearchUnit(db, get, { q, niche, platforms: yt?.platforms ?? [] }),
            { holds, id: q },
          );
          if (!r.ok) {
            stats.stopped = r.reason;
            break;
          }
          stats.stopped = countYouTubeSearchUnit(stats, r.value);
          if (stats.stopped) break;
        }
        // New firms get the niche's screen (chains, foreign, its own rule) before any stage reads them.
        const screen = yt?.screen;
        if (stats.created > 0 && screen)
          await ctx.run("screen", async () => {
            await runScreen(db, niche, screen);
          });
        await close(ctx, runId, stats);
        return stats;
      },
    ),
    fbGroups: exclusiveHandler(
      { input: LIMIT },
      async (ctx: restate.ObjectContext, input: LimitInput = {}): Promise<FbGroupsStats> => {
        // The posts become findings on main: Wren's niches only.
        if (clientOfKey(ctx.key.split("@")[0] as string))
          throw new restate.TerminalError("Facebook group reads run on Wren's niches only");
        const desk = deps.desk;
        if (!desk) throw new restate.TerminalError("no desk client for fb-public");
        const { db, niche } = scope(ctx);
        if (niche === null)
          throw new restate.TerminalError("Facebook group reads need a niche key");
        const keywords = deps.groupsFor?.(niche)?.keywords ?? [];
        const limit = input?.limit ?? 10;
        const runId = await open(ctx, FB_GROUPS_COMMAND, { limit, niche });
        const stats = emptyFbGroupsStats();
        // Searches first, so their groups and posts are in the queue the reads draw on.
        const searches = await ctx.run("select searches", async () => {
          const now = new Date();
          const { room } = await groupSearchRoom(db, now);
          return groupKeywordsDue(db, niche, keywords, { now, limit: Math.min(limit, room) });
        });
        stats.selected = searches.length;
        const holds = await stageHolds(ctx, db, HELD.groups);
        for (const q of searches.filter((x) => !holds.held.has(`search ${x}`))) {
          const r = await unit(
            ctx,
            `group search ${q}`,
            () => groupSearchUnit(db, desk, { q, niche }),
            { holds, id: `search ${q}` },
          );
          if (!r.ok) {
            stats.stopped = r.reason;
            break;
          }
          stats.stopped = countFbGroupsUnit(stats, r.value);
          if (stats.stopped) break;
        }
        if (!stats.stopped) {
          const plan = await ctx.run("select reads", async () => {
            const now = new Date();
            const { room, nextInMs } = await groupReadRoom(db, now);
            const budget = Math.min(limit - stats.selected, room);
            return {
              why:
                room === 0 && stats.selected === 0
                  ? `read bucket empty: next read in ${Math.ceil(nextInMs / 1000)}s`
                  : null,
              work: await groupReadsDue(db, niche, { now, limit: budget }),
            };
          });
          stats.stopped = plan.why;
          stats.selected += plan.work.length;
          for (const w of plan.work) {
            const id = w.kind === "about" ? `about ${w.group}` : `post ${w.post}`;
            if (holds.held.has(id)) continue;
            const r = await unit(
              ctx,
              `group ${id}`,
              () => (w.kind === "about" ? groupAboutUnit(db, desk, w) : groupPostUnit(db, desk, w)),
              { holds, id },
            );
            if (!r.ok) {
              stats.stopped = r.reason;
              break;
            }
            stats.stopped = countFbGroupsUnit(stats, r.value);
            if (stats.stopped) break;
          }
        }
        // Posts read before a firm was known, or new firms: map again, whatever stopped the reads.
        const map = await ctx.run("map posts", () => mapPosts(db, niche, new Date()));
        stats.mapped = map.mapped;
        await close(ctx, runId, stats);
        return stats;
      },
    ),
  };
}
