/**
 * `ContentMetrics/default`: looks at each young published post once a day
 * through the `Content` service and writes a snapshot row. On the first pass
 * of a Monday it sends "what worked" for the week. Cheap and read-only on
 * the platforms, so a miss just waits for the next pass.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Metrics, Platform } from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import { errorText, LAST, makeLoopObject, type PassOutcome } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { formatWhatWorked, metricsDue, recordMetrics, whatWorked } from "../metrics.js";

export const METRICS_KEY = "default";
const REPORTED = "reported";
const DEFAULT_EVERY_MS = 6 * 60 * 60 * 1000;
const REPORT_DAYS = 7;
const MONDAY = 1;

/** The `Content` service's metrics handler as the worker serves it. */
type ContentService = {
  metrics: (ctx: restate.Context, req: { platform: Platform; id: string }) => Promise<Metrics>;
};

export interface ContentMetricsDeps {
  db: Db;
  /** Sleep between passes (default 6 h; each post is still looked at once a day). */
  everyMs?: number;
  notifier?: Notifier;
}

export interface MetricsStats {
  looked: { id: string; platform: Platform; views: number }[];
  failed: { id: string; platform: Platform; error: string }[];
  reported: boolean;
}

/** The week label a Monday report belongs to (ISO date of that Monday). */
export function weekOf(now: Date): string {
  const d = new Date(now);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function makeContentMetrics(deps: ContentMetricsDeps) {
  const everyMs = deps.everyMs ?? DEFAULT_EVERY_MS;
  return makeLoopObject("ContentMetrics", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const content = ctx.serviceClient<ContentService>({ name: "Content" });
    const due = await ctx.run("metrics due", () => metricsDue(deps.db, now));
    const stats: MetricsStats = { looked: [], failed: [], reported: false };
    for (const draft of due) {
      const id = draft.publishedId;
      if (!id) continue;
      try {
        const m = await content.metrics({ platform: draft.platform, id });
        await ctx.run(`record ${draft.id}`, () => recordMetrics(deps.db, draft.id, m));
        stats.looked.push({ id: draft.id, platform: draft.platform, views: m.views });
      } catch (err) {
        if (!(err instanceof restate.TerminalError)) throw err;
        stats.failed.push({ id: draft.id, platform: draft.platform, error: errorText(err) });
      }
    }
    const notifier = deps.notifier;
    const week = weekOf(now);
    if (notifier && now.getUTCDay() === MONDAY && (await ctx.get<string>(REPORTED)) !== week) {
      const lines = await ctx.run("what worked", async () =>
        formatWhatWorked(await whatWorked(deps.db, now, { days: REPORT_DAYS })),
      );
      await ctx.run("notify", () =>
        notifier.notify(`content: what worked, week of ${week}`, lines.join("\n"), "info"),
      );
      ctx.set(REPORTED, week);
      stats.reported = true;
    }
    const outcome: PassOutcome<MetricsStats> = {
      stats,
      error: null,
      delayMs: everyMs,
      now: now.toISOString(),
    };
    ctx.set(LAST, outcome);
    return outcome;
  });
}

export type ContentMetrics = ReturnType<typeof makeContentMetrics>;
