/**
 * `AdsWatch/default`: once a day, adset-level insights for the last 7 days
 * against `ad_launches`. An active launch that spent the guard amount with
 * no clicks and no results is stopped through `Ads.stop` (journaled, so a
 * retry never stops twice), and every pass with active launches is one
 * message to the channel. It only ever stops spend. The 7 days it reads are
 * kept in `ad_days`, one row per ad set and day, for the Marketing app.
 *
 * Each call waits at most its limit (designs/2026-10-16-loop-watchdog.md): insights `LIMITS.read`
 * (cancelled past it; the pass has nothing to judge and says so), a stop or an idea `LIMITS.read`
 * left running (a write that may still land; the campaign is skipped this pass).
 */
import * as restate from "@restatedev/restate-sdk";
import type { Notifier } from "@wren/core/notify";
import {
  errorText,
  LIMITS,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  within,
} from "@wren/core/restate";
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
const DEFAULT_PAUSE_AFTER_USD = 50;

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

interface AdsWatchDeps {
  db: Db;
  everyMs?: number;
  /** Spend in the 7-day window that, with nothing to show, pauses the launch (default $50). */
  pauseAfterUsd?: number;
  notifier?: Notifier;
  /** How long a pass waits on one `Ads` or desk call (default `LIMITS.read`); tests shorten it. */
  limitMs?: number;
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
  /** Why the pass judged nothing: the insights read gave no answer in time, or refused. */
  insightsError?: string;
}

export function makeAdsWatch(deps: AdsWatchDeps) {
  const everyMs = deps.everyMs ?? DEFAULT_EVERY_MS;
  const pauseAfterUsd = deps.pauseAfterUsd ?? DEFAULT_PAUSE_AFTER_USD;
  const limitMs = deps.limitMs ?? LIMITS.read;
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
    let rows: InsightRow[] | null = null;
    if (launches.length > 0)
      try {
        rows = await within(ctx, ads.insights({ preset: "last_7d", level: "adset", daily: true }), {
          ms: limitMs,
          call: "Ads/insights",
        });
      } catch (err) {
        // No numbers, nothing to judge: tomorrow's pass reads them again.
        if (!(err instanceof restate.TerminalError)) throw err;
        stats.insightsError = errorText(err);
      }
    if (rows) {
      const read = rows;
      stats.days = await ctx.run("ad days", () => upsertAdDays(deps.db, read));
      verdicts = judge(launches, read, { pauseAfterUsd });
      for (const v of verdicts) {
        let paused = false;
        if (v.pause) {
          try {
            // A stop past its wait may still land: left running, journaled, never sent twice.
            await within(ctx, ads.stop({ campaignId: v.launch.campaignId, reason: v.pause }), {
              ms: limitMs,
              call: "Ads/stop",
              unit: v.launch.campaignId,
              keep: true,
            });
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
          const out = await within(
            ctx,
            desk.add({ text: ideaFromVerdict(v), draft: false, source: "ads" }),
            { ms: limitMs, call: "ContentDesk/add", unit: id, keep: true },
          );
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
      error: stats.insightsError ? `insights: ${stats.insightsError}` : null,
      failures: 0,
      delayMs: everyMs,
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    return outcome;
  });
}

export type AdsWatch = ReturnType<typeof makeAdsWatch>;
