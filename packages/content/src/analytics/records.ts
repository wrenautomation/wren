/**
 * Analytics as console records (designs/2026-10-07-content-analytics.md, Where each number
 * lives): how conversations go (`marketing.conversation`), the week's digest
 * (`marketing.digest`), cadence against goals (`marketing.cadence`) and every metric's state
 * (`marketing.metric`). A post's own numbers are `marketing.post`'s fields and its detail's
 * `analytics` (`postAnalytics`).
 */
import { PLATFORMS, type Platform } from "@wren/core/content";
import {
  cued,
  date,
  defineRecord,
  duration,
  link,
  number,
  rate,
  type State,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { PLATFORM_NAMES } from "../social/store.js";
import {
  ANALYTICS_CATALOG,
  CADENCE_GOALS,
  type CatalogEntry,
  type CatalogState,
  entriesFor,
  type Need,
  stateLine,
  surfaceOf,
} from "./catalog.js";

const neutral = (label: string): State => ({ label, tone: "neutral" });
const rowsOf = async <T = Record<string, unknown>>(db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as T[];

export const PLATFORM_ALL_STATES = cued({
  all: neutral("All platforms"),
  ...Object.fromEntries(PLATFORMS.map((p) => [p, neutral(PLATFORM_NAMES[p] ?? p)])),
});
const SPANS = {
  "7d": neutral("Last 7 days"),
  "30d": neutral("Last 30 days"),
  all: neutral("All time"),
};

/**
 * Comments answered, time to reply, comment to DM, DM to booking: per platform and span. No
 * footer totals: the "All platforms" row already is one.
 */
export const conversationRecord = defineRecord({
  id: "marketing.conversation",
  app: "marketing",
  channel: null,
  name: { one: "conversation", many: "conversations" },
  view: "marketing_conversation",
  key: "id",
  title: "platform",
  subtitle: "span",
  fields: {
    platform: status(PLATFORM_ALL_STATES, "Platform"),
    span: status(SPANS, "Window"),
    comments: number("Their comments", { total: false }),
    answered: rate("comments", "Answered", { from: "answered", total: false }),
    replySecs: duration("Time to reply (median)", { total: false }),
    dmed: rate("comments", "Comment to DM", { from: "dmed", total: false }),
    dms: number("DM threads", { total: false }),
    dmsAnswered: rate("dms", "DMs answered by them", { from: "dms_answered", total: false }),
    booked: rate("dms", "DM to booking", { from: "booked", total: false }),
  },
  views: [
    { id: "30d", label: "Last 30 days", where: { span: "30d" }, sort: "platform" },
    { id: "7d", label: "Last 7 days", where: { span: "7d" }, sort: "platform" },
    { id: "all", label: "All time", where: { span: "all" }, sort: "platform" },
  ],
});

const DIGEST_KINDS = {
  top: { label: "Top", tone: "good" as const },
  bottom: { label: "Bottom", tone: "warn" as const },
  moved: neutral("Moved"),
  next: { label: "Next", tone: "good" as const },
  cadence: neutral("Cadence"),
};

/** The post a digest line names, as its page's link. */
export const postHref = (id: string) => `/marketing/content/${encodeURIComponent(id)}`;

/** The latest week's digest lines, every platform's and the whole's, in their order. */
export const digestRecord = defineRecord({
  id: "marketing.digest",
  app: "marketing",
  channel: null,
  name: { one: "line", many: "lines" },
  rows: async (db) =>
    (
      await rowsOf<{
        week: string;
        platform: string;
        lines: { kind: string; text: string; post?: string }[];
      }>(
        db,
        sql`select to_char(d.week, 'YYYY-MM-DD') as week, d.platform, d.lines from content_digests d
          where d.week = (select max(week) from content_digests)`,
      )
    ).flatMap((d) =>
      d.lines.map((l, n) => ({
        id: `${d.week}:${d.platform}:${n}`,
        n,
        week: d.week,
        platform: d.platform,
        kind: l.kind,
        text: l.text,
        post: l.post ? postHref(l.post) : null,
      })),
    ),
  key: "id",
  title: "text",
  subtitle: "kind",
  fields: {
    text: text("What happened"),
    kind: status(DIGEST_KINDS, "Kind"),
    platform: status(PLATFORM_ALL_STATES, "Platform"),
    week: date("Week of"),
    post: link("The post"),
    n: number("Order", { listed: false }),
  },
  views: [
    {
      id: "worked",
      label: "What worked",
      where: { platform: "all", kind: ["top", "bottom", "moved", "next"] },
      sort: "n",
    },
    { id: "cadence", label: "Cadence", where: { platform: "all", kind: "cadence" }, sort: "n" },
    { id: "platform", label: "By platform", sort: "platform" },
  ],
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** This week's posts and thread comments against each goal: the last 7 days, as the digest. */
export const cadenceRecord = defineRecord({
  id: "marketing.cadence",
  app: "marketing",
  channel: null,
  name: { one: "goal", many: "goals" },
  rows: async (db) => {
    const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const posts = await rowsOf<{ platform: Platform; format: string; n: number }>(
      db,
      sql`select platform, format, count(*)::int n from marketing_post_records
        where published >= ${since}::timestamptz group by platform, format`,
    );
    const [threads] = await rowsOf<{ n: number }>(
      db,
      sql`select count(*)::int n from reddit_threads
        where answer_ref is not null and answered_at >= ${since}::timestamptz`,
    );
    return CADENCE_GOALS.map((g) => {
      const done =
        g.counts === "thread_comment"
          ? (threads?.n ?? 0)
          : posts
              .filter(
                (p) => p.platform === g.platform && (g.counts === "any" || p.format === g.counts),
              )
              .reduce((a, p) => a + p.n, 0);
      return {
        id: g.id,
        label: g.label,
        platform: g.platform,
        goal: g.goal,
        done,
        short: Math.max(0, g.goal - done),
        state: done >= g.goal ? "met" : done === 0 ? "none" : "behind",
      };
    });
  },
  key: "id",
  title: "label",
  subtitle: "platform",
  fields: {
    label: text("Goal"),
    platform: status(PLATFORM_ALL_STATES, "Platform"),
    done: number("Done"),
    goal: number("A week"),
    pace: rate("goal", "Of the goal", { from: "done" }),
    short: number("Still to go"),
    state: status(
      {
        met: { label: "Met", tone: "good" },
        behind: { label: "Behind", tone: "warn" },
        none: { label: "None yet", tone: "bad" },
      },
      "State",
    ),
  },
  views: [{ id: "week", label: "This week", sort: "label" }],
});

export interface SourceRow {
  platform: string;
  metric: string;
  state: string;
  why: string | null;
  checked_at: string | Date;
}

/**
 * An entry's state now: a number that came back makes it live; a refusal of one we thought
 * live says what it is, and so does a report on its way; otherwise the catalog's word stands,
 * its step with it. An account row reads the account's sources (`account.<metric>`).
 */
export function stateOf(
  e: CatalogEntry,
  sources: ReadonlyMap<string, SourceRow>,
): { state: CatalogState | "error" | "waiting"; why: string | null; checked: string | null } {
  const prefix = e.group === "account" ? "account." : "";
  const mine = e.metrics
    .map((m) => sources.get(`${e.platform}|${prefix}${m}`))
    .filter((s): s is SourceRow => !!s);
  const at = (s: SourceRow | undefined) => (s ? new Date(s.checked_at).toISOString() : null);
  const live = mine.find((s) => s.state === "live");
  if (live) return { state: "live", why: null, checked: at(live) };
  const gap = mine.find((s) => s.state === "waiting") ?? mine[0];
  if (gap && (e.state === "live" || gap.state === "waiting"))
    return { state: gap.state as CatalogState | "error", why: gap.why, checked: at(gap) };
  return { state: e.state, why: gap?.why ?? null, checked: at(gap) };
}

export const readSources = async (db: Queryable): Promise<Map<string, SourceRow>> =>
  new Map(
    (
      await rowsOf<SourceRow>(
        db,
        sql`select platform, metric, state, why, checked_at from metric_sources`,
      )
    ).map((s) => [`${s.platform}|${s.metric}`, s]),
  );

const STATE_LABELS: Record<string, State> = {
  live: { label: "Live", tone: "good" },
  needs_scope: { label: "Needs scope", tone: "warn" },
  needs_william: { label: "Needs William", tone: "warn" },
  not_built: neutral("In development"),
  no_api: neutral("Not in the API"),
  waiting: neutral("Waiting"),
  error: { label: "Refused", tone: "bad" },
};
const SURFACES = { long: neutral("Long-form"), short: neutral("Shorts"), post: neutral("Posts") };

/** Every number the catalog names, with its state and the one step that would make it live. */
export const metricRecord = defineRecord({
  id: "marketing.metric",
  app: "marketing",
  channel: null,
  name: { one: "metric", many: "metrics" },
  rows: async (db) => {
    const sources = await readSources(db);
    return ANALYTICS_CATALOG.map((e, i) => {
      const s = stateOf(e, sources);
      return {
        id: String(i + 1),
        label: e.label,
        platform: e.platform,
        surface: e.surface ?? null,
        group: e.group,
        state: s.state,
        says: stateLine(s.state, e.needs, s.why),
        step: e.needs?.step ?? null,
        api: e.api,
        why: s.why,
        checked: s.checked,
        gap: s.state === "live" ? "live" : "gap",
      };
    });
  },
  key: "id",
  title: "label",
  subtitle: "says",
  fields: {
    label: text("Metric"),
    platform: status(PLATFORM_ALL_STATES, "Platform"),
    surface: status(SURFACES, "Where"),
    state: status(STATE_LABELS, "State"),
    says: text("Says", { listed: false }),
    step: text("What makes it live"),
    api: text("Read from", { listed: false }),
    why: text("The platform's words", { listed: false }),
    checked: date("Last asked", { listed: false }),
    group: status(
      cued({
        reach: neutral("Reach"),
        retention: neutral("Retention"),
        engagement: neutral("Engagement"),
        conversation: neutral("Conversation"),
        funnel: neutral("Funnel"),
        iteration: neutral("Iteration"),
        account: neutral("Account"),
      }),
      "About",
    ),
    gap: status({ live: neutral("Live"), gap: neutral("Not live") }, "Live", { listed: false }),
  },
  views: [
    { id: "gaps", label: "Not live", where: { gap: "gap" }, sort: "platform" },
    {
      id: "scope",
      label: "Needs a step",
      where: { state: ["needs_scope", "needs_william"] },
      sort: "platform",
    },
    { id: "all", label: "All", sort: "platform" },
  ],
});

export const ANALYTICS_RECORDS = [conversationRecord, digestRecord, cadenceRecord, metricRecord];

// ---- A post's detail ----

export interface MetricCell {
  label: string;
  metrics: readonly string[];
  group: string;
  state: string;
  says: string;
  need: Need | null;
  why: string | null;
  /** Latest value per metric, when it came back. */
  latest: Record<string, number>;
}

export interface PostAnalytics {
  platform: Platform;
  surface: "long" | "short" | "post";
  /** Each metric's days, oldest first; views, likes, comments and shares from every look. */
  series: Record<string, { at: string; value: number }[]>;
  /** The latest retention curve: the share of the video (0..1) and the share still watching. */
  curve: { at: number; value: number }[];
  relative: { at: number; value: number }[];
  sources: { key: string; value: number }[];
  terms: { key: string; value: number }[];
  cells: MetricCell[];
  site: {
    clicks: number;
    hops: number;
    formsFirst: number;
    formsLast: number;
    callsFirst: number;
    callsLast: number;
    wonFirst: number;
    wonLast: number;
    revenueFirst: number;
    revenueLast: number;
    links: { source: string; campaign: string; content: string; clicks: number }[];
  };
  conversation: { theirs: number; answered: number; replySecs: number | null; dmed: number };
}

/** Everything a post's page draws under "How it did", "What it brought" and "Its conversation". */
export async function postAnalytics(db: Queryable, draftId: string): Promise<PostAnalytics | null> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return null;
  const [d] = await rowsOf<{
    platform: Platform;
    kind: string | null;
    published_id: string | null;
    ref: string | null;
  }>(
    db,
    sql`select d.platform, d.extra->>'kind' kind, d.published_id, i.ref from content_drafts d
      join content_ideas i on i.id = d.idea_id where d.id = ${draftId}::uuid`,
  );
  if (!d) return null;
  const surface = surfaceOf(d.platform, d.kind);
  const rows = await rowsOf<{ day: string; metric: string; key: string; value: number }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day, metric, key, value from post_metric_days
      where draft_id = ${draftId}::uuid order by day, metric, key`,
  );
  const series: PostAnalytics["series"] = {};
  const latest: Record<string, number> = {};
  for (const r of rows.filter((r) => r.key === "")) {
    const days = series[r.metric] ?? [];
    days.push({ at: r.day, value: Number(r.value) });
    series[r.metric] = days;
    latest[r.metric] = Number(r.value);
  }
  // The counts before insights existed: every look's snapshot, its day's last.
  const looks = await rowsOf<{
    day: string;
    views: number;
    reactions: number;
    comments: number;
    shares: number;
  }>(
    db,
    sql`select distinct on (as_of::date) to_char(as_of, 'YYYY-MM-DD') as day, views, reactions, comments,
      shares from content_metrics where draft_id = ${draftId}::uuid order by as_of::date, created_at desc`,
  );
  for (const [metric, col] of [
    ["views", "views"],
    ["likes", "reactions"],
    ["comments", "comments"],
    ["shares", "shares"],
  ] as const) {
    const have = new Set((series[metric] ?? []).map((p) => p.at));
    const extra = looks
      .filter((l) => !have.has(l.day))
      .map((l) => ({ at: l.day, value: Number(l[col]) }));
    if (extra.length)
      series[metric] = [...(series[metric] ?? []), ...extra].sort((a, b) => (a.at < b.at ? -1 : 1));
    const last = series[metric]?.at(-1);
    if (last && latest[metric] === undefined) latest[metric] = last.value;
  }
  // Ours, per day: likes, comments and shares per 100 views, and per 100 followers that day.
  const followers = await rowsOf<{ day: string; followers: number }>(
    db,
    sql`select to_char(day, 'YYYY-MM-DD') as day, followers from social_days
      where platform = ${d.platform} order by day`,
  );
  const engaged = (series.views ?? []).flatMap((v) => {
    const at = (m: string) => series[m]?.find((p) => p.at === v.at)?.value ?? 0;
    return [{ at: v.at, n: at("likes") + at("comments") + at("shares"), views: v.value }];
  });
  const per = (metric: string, of: (e: (typeof engaged)[number]) => number | undefined) => {
    const pts = engaged.flatMap((e) => {
      const base = of(e);
      return base ? [{ at: e.at, value: (e.n / base) * 100 }] : [];
    });
    if (!pts.length) return;
    series[metric] = pts;
    latest[metric] = pts.at(-1)?.value as number;
  };
  per("engagement", (e) => e.views);
  per("per_follower", (e) => followers.filter((f) => f.day <= e.at).at(-1)?.followers);
  const lastDay = (metric: string) => rows.filter((r) => r.metric === metric).at(-1)?.day;
  const keyed = (metric: string) => {
    const day = lastDay(metric);
    return rows
      .filter((r) => r.metric === metric && r.day === day && r.key !== "")
      .map((r) => ({ key: r.key, value: Number(r.value) }));
  };
  const curveOf = (metric: string) =>
    keyed(metric)
      .map((p) => ({ at: Number(p.key), value: p.value }))
      .filter((p) => Number.isFinite(p.at))
      .sort((a, b) => a.at - b.at);
  const sources = await readSources(db);
  const cells: MetricCell[] = entriesFor(d.platform, surface).map((e) => {
    const s = stateOf(e, sources);
    const mine: Record<string, number> = {};
    for (const m of e.metrics) if (latest[m] !== undefined) mine[m] = latest[m] as number;
    return {
      label: e.label,
      metrics: e.metrics,
      group: e.group,
      state: s.state,
      says: stateLine(s.state, e.needs, s.why),
      need: e.needs ?? null,
      why: s.why,
      latest: mine,
    };
  });
  const video =
    // A Short's links can't be clicked: the footer's visitors are its long video's alone.
    d.platform === "youtube" && surface === "long"
      ? (/^video:([0-9]+)(~|$)/.exec(d.ref ?? "")?.[1] ?? null)
      : null;
  const links = await rowsOf<{
    source: string;
    campaign: string;
    content: string;
    clicks: number;
    hops: number;
    forms_first: number;
    forms_last: number;
    calls_first: number;
    calls_last: number;
    won_first: number;
    won_last: number;
    revenue_first: number;
    revenue_last: number;
  }>(
    db,
    sql`select source, campaign, content, sum(clicks)::int clicks, sum(hops)::int hops,
      sum(forms_first)::int forms_first, sum(forms_last)::int forms_last,
      sum(calls_first)::int calls_first, sum(calls_last)::int calls_last,
      sum(won_first)::int won_first, sum(won_last)::int won_last,
      sum(revenue_first)::int revenue_first, sum(revenue_last)::int revenue_last
    from link_days
    where content = ${draftId.slice(0, 8)}
      or (${video}::text is not null and source = 'youtube' and content = ''
        and (campaign = ${video}::text or campaign like ${video}::text || '-%'))
    group by source, campaign, content order by sum(clicks) desc`,
  );
  const sum = (k: keyof (typeof links)[number]) => links.reduce((a, l) => a + Number(l[k] ?? 0), 0);
  const [c] = d.published_id
    ? await rowsOf<{ theirs: number; answered: number; reply_secs: number | null; dmed: number }>(
        db,
        sql`select count(*)::int theirs, count(answered_at)::int answered, count(contact_id)::int dmed,
          (percentile_cont(0.5) within group (order by extract(epoch from answered_at - at))
            filter (where answered_at is not null))::float8 reply_secs
        from comments where post = ${d.published_id} and platform::text = ${d.platform}
          and sort is distinct from 'ours' and state <> 'dropped'`,
      )
    : [];
  return {
    platform: d.platform,
    surface,
    series,
    curve: curveOf("retention"),
    relative: curveOf("relative_retention"),
    sources: keyed("traffic_source").sort((a, b) => b.value - a.value),
    terms: keyed("search_term").sort((a, b) => b.value - a.value),
    cells,
    site: {
      clicks: sum("clicks"),
      hops: sum("hops"),
      formsFirst: sum("forms_first"),
      formsLast: sum("forms_last"),
      callsFirst: sum("calls_first"),
      callsLast: sum("calls_last"),
      wonFirst: sum("won_first"),
      wonLast: sum("won_last"),
      revenueFirst: sum("revenue_first") / 100,
      revenueLast: sum("revenue_last") / 100,
      links: links.map((l) => ({
        source: l.source,
        campaign: l.campaign,
        content: l.content,
        clicks: Number(l.clicks),
      })),
    },
    conversation: {
      theirs: c?.theirs ?? 0,
      answered: c?.answered ?? 0,
      replySecs: c?.reply_secs ?? null,
      dmed: c?.dmed ?? 0,
    },
  };
}
