/**
 * `AdsWatch/default`: once a day, adset-level insights for the last 7 days
 * against `ad_launches`. An active launch that spent the guard amount with
 * no clicks and no results is stopped through `Ads.stop` (journaled, so a
 * retry never stops twice), and every pass with active launches is one
 * message to the channel. It only ever stops spend.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import { errorText, LAST, makeLoopObject, type PassOutcome } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { InsightRow } from "./ads.js";
import { activeLaunches, formatVerdicts, judge, type Verdict } from "./launches.js";

export const WATCH_KEY = "default";
const DEFAULT_EVERY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PAUSE_AFTER_USD = 50;

/** The `Ads` service's handlers this loop calls, as the worker serves them. */
type AdsService = {
  insights: (
    ctx: restate.Context,
    req: { preset?: string; level?: "account" | "campaign" | "adset" | "ad" },
  ) => Promise<InsightRow[]>;
  stop: (ctx: restate.Context, req: { campaignId: string; reason?: string }) => Promise<void>;
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
  verdicts: {
    campaignId: string;
    name: string;
    spendUsd: number;
    clicks: number;
    results: number;
    paused: boolean;
  }[];
  failed: { campaignId: string; error: string }[];
}

export function makeAdsWatch(deps: AdsWatchDeps) {
  const everyMs = deps.everyMs ?? DEFAULT_EVERY_MS;
  const pauseAfterUsd = deps.pauseAfterUsd ?? DEFAULT_PAUSE_AFTER_USD;
  return makeLoopObject("AdsWatch", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const ads = ctx.serviceClient<AdsService>({ name: "Ads" });
    const launches = await ctx.run("active launches", () => activeLaunches(deps.db));
    const stats: WatchStats = { active: launches.length, verdicts: [], failed: [] };
    let verdicts: Verdict[] = [];
    if (launches.length > 0) {
      const rows = await ads.insights({ preset: "last_7d", level: "adset" });
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
      if (deps.notifier) {
        const notifier = deps.notifier;
        const lines = formatVerdicts(verdicts);
        const level = verdicts.some((v) => v.pause) ? "warning" : "info";
        await ctx.run("notify", () => notifier.notify("ads: last 7 days", lines.join("\n"), level));
      }
    }
    const outcome: PassOutcome<WatchStats> = {
      stats,
      error: null,
      delayMs: everyMs,
      now: now.toISOString(),
    };
    ctx.set(LAST, outcome);
    return outcome;
  });
}

export type AdsWatch = ReturnType<typeof makeAdsWatch>;
