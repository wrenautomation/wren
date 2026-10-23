/**
 * `ContentMetrics/default`: looks at each young published post on its tier (`LOOK_TIERS`:
 * every 6 hours at first, then daily, then weekly) through the `Content` service and writes a
 * snapshot row. On the first pass of a Monday it sends "what worked" for the week. Cheap and
 * read-only on the platforms, so a miss just waits for the next pass.
 *
 * A pass reads each platform's due posts in one `metricsMany` where the channel has one (a
 * timeline, a listing or a batch query holds many posts), and a post it left out alone.
 *
 * `ContentMetrics/<client>/posts`: the same for a client's posts, read on its own logins into its
 * own database. No Monday report: that goes to Wren's lane.
 *
 * Each look also reads the post's insights (designs/2026-10-07-content-analytics.md) into
 * `post_metric_days`, and once a day each account's into `account_metric_days`. A refused
 * insight is a gap row, never a failed look. Each pass also reads the platforms' new report days
 * (YouTube's reach report: impressions and CTR per video per day) from where the last left off,
 * unless the last read found nothing new less than 6 hours ago.
 * Monday's pass keeps the week's digest.
 *
 * Every `Content` call waits at most its limit (`LIMITS`, designs/2026-10-16-loop-watchdog.md):
 * a read that gives no answer is cancelled and its post skipped till the next pass. A platform
 * that times out twice in a pass is left for the next; a post that times out three passes in a
 * row is held (`unit_holds`, stage `loop.content-metrics/<key>`).
 */
import * as restate from "@restatedev/restate-sdk";
import type {
  AccountInsights,
  Insights,
  InsightValue,
  Metrics,
  Platform,
  ReportDays,
} from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import {
  clientOfKey,
  errorText,
  type Limits,
  limitsWith,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
  unitLimits,
  within,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import { writeDigest } from "../analytics/digest.js";
import { writeAccountInsights, writeInsights, writeReportDays } from "../analytics/store.js";
import { clientContent } from "../clients.js";
import { formatWhatWorked, metricsDue, recordMetrics, whatWorked } from "../metrics.js";
import type { ContentDraft } from "../schema.js";

export const METRICS_KEY = "default";
const REPORTED = "reported";
/** The UTC day accounts were last read. */
const ACCOUNTS = "accounts";
/** Per platform, the create time of the newest report read: `reports.<platform>`. */
const REPORTS = "reports.";
/** Per platform, when a report read last found nothing new: `reports-quiet.<platform>`. */
const REPORTS_QUIET = "reports-quiet.";
const REPORTS_EVERY_MS = 6 * 60 * 60 * 1000;
/** The week whose digest was last kept. */
const DIGESTED = "digested";
/** Hourly: a pass finds the posts whose tier is due (`LOOK_TIERS`, every 6 hours at the soonest). */
const DEFAULT_EVERY_MS = 60 * 60 * 1000;
const REPORT_DAYS = 7;
const MONDAY = 1;

/** The `Content` service's metrics handler as the worker serves it. */
type ContentService = {
  metrics: (
    ctx: restate.Context,
    req: { platform: Platform; id: string; client?: string | null },
  ) => Promise<Metrics>;
  metricsMany: (
    ctx: restate.Context,
    req: {
      platform: Platform;
      posts: { id: string; kind?: string | null }[];
      client?: string | null;
    },
  ) => Promise<Metrics[] | null>;
  insights: (
    ctx: restate.Context,
    req: {
      platform: Platform;
      id: string;
      published?: string | null;
      kind?: string | null;
      media?: "image" | "video" | null;
      read?: unknown;
      client?: string | null;
    },
  ) => Promise<Insights | null>;
  platforms: (ctx: restate.Context) => Promise<Platform[]>;
  accountInsights: (
    ctx: restate.Context,
    req: { platform: Platform; client?: string | null },
  ) => Promise<AccountInsights | null>;
  reportDays: (
    ctx: restate.Context,
    req: { platform: Platform; after?: string | null; client?: string | null },
  ) => Promise<ReportDays | null>;
};

/**
 * A look from insights that read the post's own counts (`fetchedWith` set), for a post whose
 * counts read has no leg. Views are impressions where a platform has no views. Null: no counts.
 */
export function lookOf(id: string, i: Insights): Metrics | null {
  if (!i.fetchedWith) return null;
  const of = (metric: string) => i.values.find((v) => v.metric === metric && v.key == null)?.value;
  const counts = [of("views") ?? of("impressions"), of("likes"), of("comments"), of("shares")];
  if (counts.every((c) => c === undefined)) return null;
  const [views, reactions, comments, shares] = counts.map((c) => c ?? 0) as [
    number,
    number,
    number,
    number,
  ];
  return { id, views, reactions, comments, shares, asOf: i.asOf, fetchedWith: i.fetchedWith };
}

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
  /** Sleep between passes (default 1 h; a post's tier decides which are looked at). */
  everyMs?: number;
  notifier?: Notifier;
  /** A client's database; absent, a client's key stops. */
  clientDb?: ((client: string) => Db) | null;
  /** Each call's limit over `LIMITS` (tests shorten them). */
  limits?: Partial<Limits>;
}

export interface MetricsStats {
  looked: { id: string; platform: Platform; views: number; insights?: number; gaps?: number }[];
  failed: { id: string; platform: Platform; error: string }[];
  reported: boolean;
  /** Report day rows written per platform; an error's text where a read failed. */
  reports?: Partial<Record<Platform, number | string>>;
  /** Account rows written per platform, once a day; an error's text where a read failed. */
  accounts?: Partial<Record<Platform, number | string>>;
  digest?: boolean;
  /** Reads left out: their post is held, or their platform timed out twice this pass. */
  skipped?: number;
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
  const L = limitsWith(deps.limits);
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
    const limits = await unitLimits(ctx, deps.db, "ContentMetrics");
    const due = await ctx.run("metrics due", () => metricsDue(db, now));
    const stats: MetricsStats = { looked: [], failed: [], reported: false };
    /** A read's unit, or false (and counted) when this pass leaves it out. */
    const go = (unit: string, platform: Platform) => {
      if (!limits.skip(unit, platform)) return true;
      stats.skipped = (stats.skipped ?? 0) + 1;
      return false;
    };
    // One read a platform for all its due posts, where the channel has one: the counts come
    // back by id. A post it left out, or a platform whose batch refused, is read alone below.
    const batched = new Map<string, Metrics>();
    const byPlatform = new Map<Platform, ContentDraft[]>();
    for (const d of due)
      if (d.publishedId) byPlatform.set(d.platform, [...(byPlatform.get(d.platform) ?? []), d]);
    for (const [platform, drafts] of byPlatform) {
      const unit = `batch ${platform}`;
      if (!go(unit, platform)) continue;
      try {
        const got = await limits.within(
          unit,
          content.metricsMany({
            platform,
            posts: drafts.map((d) => ({
              id: d.publishedId as string,
              kind: typeof d.extra?.kind === "string" ? d.extra.kind : null,
            })),
            ...(client ? { client } : {}),
          }),
          { ms: L.batch, call: "Content/metricsMany", group: platform },
        );
        for (const m of got ?? []) batched.set(`${platform}:${m.id}`, m);
      } catch (err) {
        if (!(err instanceof restate.TerminalError)) throw err;
      }
    }
    for (const draft of due) {
      const id = draft.publishedId;
      if (!id) continue;
      const post = `${draft.platform}:${id}`;
      const read = batched.get(post);
      if (!read && !go(`metrics ${post}`, draft.platform)) continue;
      try {
        let m: Metrics | null = read ?? null;
        // A counts read with no leg yet (501) or one that missed (a LinkedIn share's page) still
        // leaves the deeper read, which may hold the counts too (LinkedIn's analytics page): the
        // look is then built from it.
        let unbuilt: restate.TerminalError | null = null;
        try {
          m ??= await limits.within(
            `metrics ${post}`,
            content.metrics({ platform: draft.platform, id, ...(client ? { client } : {}) }),
            { ms: L.read, call: "Content/metrics", group: draft.platform },
          );
        } catch (err) {
          if (!(err instanceof restate.TerminalError) || (err.code !== 501 && err.code !== 502))
            throw err;
          unbuilt = err;
        }
        if (m) {
          const look = m;
          await ctx.run(`record ${draft.id}`, () => recordMetrics(db, draft.id, look));
        }
        // Insights after the counts: a refusal here costs the deeper numbers, never the look.
        let i: Insights | null = null;
        try {
          if (go(`insights ${post}`, draft.platform))
            i = await limits.within(
              `insights ${post}`,
              content.insights({
                platform: draft.platform,
                id,
                // Journaled rows come back as JSON: a date is a string.
                published: draft.publishedAt ? new Date(draft.publishedAt).toISOString() : null,
                kind: typeof draft.extra?.kind === "string" ? draft.extra.kind : null,
                media: draft.media?.kind ?? null,
                // What the counts read answered: a channel reuses it rather than read the post again.
                read: m?.read,
                ...(client ? { client } : {}),
              }),
              { ms: L.read, call: "Content/insights", group: draft.platform },
            );
        } catch (err) {
          if (!(err instanceof restate.TerminalError)) throw err;
        }
        if (!m) {
          const look = i ? lookOf(id, i) : null;
          if (!look) throw unbuilt;
          await ctx.run(`record ${draft.id}`, () => recordMetrics(db, draft.id, look));
          m = look;
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
    // Reports' new days and the accounts' (once a UTC day): Wren's own only.
    const platforms = client
      ? []
      : await within(ctx, content.platforms(), {
          ms: L.quick,
          call: "Content/platforms",
        }).catch((err: unknown) => {
          if (!(err instanceof restate.TerminalError)) throw err;
          return [] as Platform[];
        });
    for (const platform of platforms) {
      const unit = `reports ${platform}`;
      if (!go(unit, platform)) continue;
      try {
        // A read that found nothing new waits REPORTS_EVERY_MS: reports land once a day.
        const quiet = await ctx.get<string>(`${REPORTS_QUIET}${platform}`);
        if (quiet && now.getTime() - new Date(quiet).getTime() < REPORTS_EVERY_MS) continue;
        const after = await ctx.get<string>(`${REPORTS}${platform}`);
        const r = await limits.within(
          unit,
          content.reportDays({ platform, after: after ?? null }),
          { ms: L.read, call: "Content/reportDays", group: platform },
        );
        if (!r?.rows.length) ctx.set(`${REPORTS_QUIET}${platform}`, now.toISOString());
        if (!r) continue;
        stats.reports ??= {};
        stats.reports[platform] = await ctx.run(`reports ${platform}`, () =>
          writeReportDays(db, platform, r, now),
        );
        if (r.cursor) ctx.set(`${REPORTS}${platform}`, r.cursor);
      } catch (err) {
        if (!(err instanceof restate.TerminalError)) throw err;
        stats.reports ??= {};
        stats.reports[platform] = errorText(err);
      }
    }
    const today = now.toISOString().slice(0, 10);
    if (!client && (await ctx.get<string>(ACCOUNTS)) !== today) {
      stats.accounts = {};
      for (const platform of platforms) {
        const unit = `account ${platform}`;
        if (!go(unit, platform)) continue;
        try {
          const a = await limits.within(unit, content.accountInsights({ platform }), {
            ms: L.read,
            call: "Content/accountInsights",
            group: platform,
          });
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
    if (!client && now.getUTCDay() === MONDAY && (await ctx.get<string>(DIGESTED)) !== week) {
      stats.digest = await ctx.run("digest", () => writeDigest(deps.db, now, week));
      ctx.set(DIGESTED, week);
    }
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
