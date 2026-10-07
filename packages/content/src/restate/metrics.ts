/**
 * `ContentMetrics/default`: looks at each young published post once a day
 * through the `Content` service and writes a snapshot row. On the first pass
 * of a Monday it sends "what worked" for the week. Cheap and read-only on
 * the platforms, so a miss just waits for the next pass.
 *
 * `ContentMetrics/<client>/posts`: the same for a client's posts, read on its own logins into its
 * own database. No Monday report: that goes to Wren's lane.
 *
 * Each look also reads the post's insights (designs/2026-10-07-content-analytics.md) into
 * `post_metric_days`, and once a day each account's into `account_metric_days`. A refused
 * insight is a gap row, never a failed look. Monday's pass keeps the week's digest.
 */
import * as restate from "@restatedev/restate-sdk";
import type {
  AccountInsights,
  Insights,
  InsightValue,
  Metrics,
  Platform,
} from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import {
  clientOfKey,
  errorText,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import { writeDigest } from "../analytics/digest.js";
import { writeAccountInsights, writeInsights } from "../analytics/store.js";
import { clientContent } from "../clients.js";
import { formatWhatWorked, metricsDue, recordMetrics, whatWorked } from "../metrics.js";

export const METRICS_KEY = "default";
const REPORTED = "reported";
/** The UTC day accounts were last read. */
const ACCOUNTS = "accounts";
const DEFAULT_EVERY_MS = 6 * 60 * 60 * 1000;
const REPORT_DAYS = 7;
const MONDAY = 1;

/** The `Content` service's metrics handler as the worker serves it. */
type ContentService = {
  metrics: (
    ctx: restate.Context,
    req: { platform: Platform; id: string; client?: string | null },
  ) => Promise<Metrics>;
  insights: (
    ctx: restate.Context,
    req: {
      platform: Platform;
      id: string;
      published?: string | null;
      kind?: string | null;
      client?: string | null;
    },
  ) => Promise<Insights | null>;
  platforms: (ctx: restate.Context) => Promise<Platform[]>;
  accountInsights: (
    ctx: restate.Context,
    req: { platform: Platform; client?: string | null },
  ) => Promise<AccountInsights | null>;
};

/** The counts every look reads, under the names insights use; insights' own win a tie. */
export function withCounts(m: Metrics, i: Insights | null): Insights {
  const got = new Set((i?.values ?? []).map((v) => `${v.metric}|${v.key ?? ""}`));
  const counts: InsightValue[] = [
    { metric: "views", value: m.views },
    { metric: "likes", value: m.reactions },
    { metric: "comments", value: m.comments },
    { metric: "shares", value: m.shares },
    ...(typeof m.follows === "number" ? [{ metric: "follows", value: m.follows }] : []),
  ];
  return {
    values: [...(i?.values ?? []), ...counts.filter((c) => !got.has(`${c.metric}|`))],
    gaps: i?.gaps ?? [],
    asOf: i?.asOf ?? m.asOf,
  };
}

export interface ContentMetricsDeps {
  db: Db;
  /** Sleep between passes (default 6 h; each post is still looked at once a day). */
  everyMs?: number;
  notifier?: Notifier;
  /** A client's database; absent, a client's key stops. */
  clientDb?: ((client: string) => Db) | null;
}

export interface MetricsStats {
  looked: { id: string; platform: Platform; views: number; insights?: number; gaps?: number }[];
  failed: { id: string; platform: Platform; error: string }[];
  reported: boolean;
  /** Account rows written per platform, once a day; an error's text where a read failed. */
  accounts?: Partial<Record<Platform, number | string>>;
  digest?: boolean;
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
    const owner = clientOfKey(ctx.key);
    const client = owner?.client ?? null;
    if (client) {
      if (!deps.clientDb) return stoppedPass<MetricsStats>(ctx, now, "no client databases here");
      const plan = await ctx.run("client", () => clientContent(deps.db, client, "content.posting"));
      if (plan.kind === "gone") return stoppedPass<MetricsStats>(ctx, now, plan.why);
    }
    const db = client && deps.clientDb ? deps.clientDb(client) : deps.db;
    const due = await ctx.run("metrics due", () => metricsDue(db, now));
    const stats: MetricsStats = { looked: [], failed: [], reported: false };
    for (const draft of due) {
      const id = draft.publishedId;
      if (!id) continue;
      try {
        const m = await content.metrics({
          platform: draft.platform,
          id,
          ...(client ? { client } : {}),
        });
        await ctx.run(`record ${draft.id}`, () => recordMetrics(db, draft.id, m));
        // Insights after the counts: a refusal here costs the deeper numbers, never the look.
        let i: Insights | null = null;
        try {
          i = await content.insights({
            platform: draft.platform,
            id,
            published: draft.publishedAt?.toISOString() ?? null,
            kind: typeof draft.extra?.kind === "string" ? draft.extra.kind : null,
            ...(client ? { client } : {}),
          });
        } catch (err) {
          if (!(err instanceof restate.TerminalError)) throw err;
        }
        const all = withCounts(m, i);
        const rows = await ctx.run(`insights ${draft.id}`, () =>
          writeInsights(db, draft.id, draft.platform, all, now),
        );
        stats.looked.push({
          id: draft.id,
          platform: draft.platform,
          views: m.views,
          insights: rows,
          gaps: all.gaps.length,
        });
      } catch (err) {
        if (!(err instanceof restate.TerminalError)) throw err;
        stats.failed.push({ id: draft.id, platform: draft.platform, error: errorText(err) });
      }
    }
    // The accounts' days, once a UTC day: Wren's own only.
    const today = now.toISOString().slice(0, 10);
    if (!client && (await ctx.get<string>(ACCOUNTS)) !== today) {
      stats.accounts = {};
      for (const platform of await content.platforms()) {
        try {
          const a = await content.accountInsights({ platform });
          if (!a) continue;
          stats.accounts[platform] = await ctx.run(`account ${platform}`, () =>
            writeAccountInsights(db, platform, a, now),
          );
        } catch (err) {
          if (!(err instanceof restate.TerminalError)) throw err;
          stats.accounts[platform] = errorText(err);
        }
      }
      ctx.set(ACCOUNTS, today);
    }
    const notifier = client ? undefined : deps.notifier;
    const week = weekOf(now);
    // The week's digest, kept for the drafts' prompts and the Overview, whether or not it's sent.
    if (!client && now.getUTCDay() === MONDAY)
      stats.digest = await ctx.run("digest", () => writeDigest(deps.db, now, weekOf(now)));
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
      failures: 0,
      delayMs: everyMs,
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    return outcome;
  });
}

export type ContentMetrics = ReturnType<typeof makeContentMetrics>;
