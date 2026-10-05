/**
 * `AdsWatch/default`: once a day, adset-level insights for the last 7 days
 * against `ad_launches`. An active launch that spent the guard amount with
 * no clicks and no results is stopped through `Ads.stop` (journaled, so a
 * retry never stops twice), and every pass with active launches is one
 * message to the channel. It only ever stops spend. The 7 days it reads are
 * kept in `ad_days`, one row per ad set and day, for the Marketing app.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { errorText, makeLoopObject, type PassOutcome, setLastPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { InsightRow } from "./ads.js";
import { ideaFromVerdict, isWinner } from "./bridge.js";
import { upsertAdDays } from "./days.js";
import { activeLaunches, formatVerdicts, judge, type Verdict } from "./launches.js";

export const WATCH_KEY = "default";
/** Campaign ids already handed to the content loop as ideas. */
const SUGGESTED = "suggested";
const DESK_KEY = "default";
const DEFAULT_EVERY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PAUSE_AFTER_USD = 50;

/** The `Ads` service's handlers this loop calls, as the worker serves them. */
type AdsService = {
  insights: (
    ctx: restate.Context,
    req: { preset?: string; level?: "account" | "campaign" | "adset" | "ad"; daily?: boolean },
  ) => Promise<InsightRow[]>;
  stop: (ctx: restate.Context, req: { campaignId: string; reason?: string }) => Promise<void>;
};

/** The content desk's `add`, as the worker serves it; `draft: false` so nothing is paid for until the person drafts. */
type ContentDesk = {
  add: (
    ctx: restate.Context,
    req: { text: string; draft?: boolean; source?: "ads" },
  ) => Promise<{ idea: { id: string } }>;
};

export interface AdsWatchDeps {
  db: Db;
  everyMs?: number;
  /** Spend in the 7-day window that, with nothing to show, pauses the launch (default $50). */
  pauseAfterUsd?: number;
  notifier?: Notifier;
}

export interface WatchStats {
  active: number;
  /** Ad set days written to `ad_days`. */
  days: number;
  verdicts: {
    campaignId: string;
    name: string;
    spendUsd: number;
    clicks: number;
    results: number;
    paused: boolean;
  }[];
  failed: { campaignId: string; error: string }[];
  /** Winners handed to the content loop this pass, as idea ids. */
  ideas: { campaignId: string; ideaId: string }[];
}

export function makeAdsWatch(deps: AdsWatchDeps) {
  const everyMs = deps.everyMs ?? DEFAULT_EVERY_MS;
  const pauseAfterUsd = deps.pauseAfterUsd ?? DEFAULT_PAUSE_AFTER_USD;
  return makeLoopObject("AdsWatch", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const ads = ctx.serviceClient<AdsService>({ name: "Ads" });
    const launches = await ctx.run("active launches", () => activeLaunches(deps.db));
    const stats: WatchStats = {
      active: launches.length,
      days: 0,
      verdicts: [],
      failed: [],
      ideas: [],
    };
    let verdicts: Verdict[] = [];
    if (launches.length > 0) {
      const rows = await ads.insights({ preset: "last_7d", level: "adset", daily: true });
      stats.days = await ctx.run("ad days", () => upsertAdDays(deps.db, rows));
      verdicts = judge(launches, rows, { pauseAfterUsd });
      for (const v of verdicts) {
        let paused = false;
        if (v.pause) {
          try {
            await ads.stop({ campaignId: v.launch.campaignId, reason: v.pause });
            paused = true;
          } catch (err) {
            if (!(err instanceof restate.TerminalError)) throw err;
            stats.failed.push({ campaignId: v.launch.campaignId, error: errorText(err) });
          }
        }
        stats.verdicts.push({
          campaignId: v.launch.campaignId,
          name: v.launch.name,
          spendUsd: v.result.spendUsd,
          clicks: v.result.clicks,
          results: v.result.results,
          paused,
        });
      }
      // A winner becomes one idea, once: the desk stores it open; the person drafts it.
      const suggested = (await ctx.get<string[]>(SUGGESTED)) ?? [];
      const desk = ctx.objectClient<ContentDesk>({ name: "ContentDesk" }, DESK_KEY);
      for (const v of verdicts) {
        const id = v.launch.campaignId;
        if (!isWinner(v) || suggested.includes(id)) continue;
        try {
          const out = await desk.add({ text: ideaFromVerdict(v), draft: false, source: "ads" });
          suggested.push(id);
          stats.ideas.push({ campaignId: id, ideaId: out.idea.id });
        } catch (err) {
          if (!(err instanceof restate.TerminalError)) throw err;
          stats.failed.push({ campaignId: id, error: errorText(err) });
        }
      }
      ctx.set(SUGGESTED, suggested);
      if (deps.notifier) {
        const notifier = deps.notifier;
        const lines = formatVerdicts(verdicts);
        for (const i of stats.ideas)
          lines.push(`→ idea ${i.ideaId} for the content loop (wren content ideas)`);
        const level = verdicts.some((v) => v.pause) ? "warning" : "info";
        await ctx.run("notify", () => notifier.notify("ads: last 7 days", lines.join("\n"), level));
      }
    }
    const outcome: PassOutcome<WatchStats> = {
      stats,
      error: null,
      failures: 0,
      delayMs: everyMs,
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    return outcome;
  });
}

export type AdsWatch = ReturnType<typeof makeAdsWatch>;
