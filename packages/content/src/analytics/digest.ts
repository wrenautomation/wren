/**
 * The week's "what worked" (designs/2026-10-07-content-analytics.md, Digest): per platform and
 * for all of them, the best and worst post, the number that moved most against the week before,
 * what to make next, and cadence against the goals. Built in code from rows we hold, kept in
 * `content_digests`, shown on the Overview and read into the next drafts' prompts. Never sent.
 */
import { PLATFORMS, type Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { desc, sql } from "drizzle-orm";
import { type ContentDraft, contentDigests, type DigestLine, formatSql } from "../schema.js";
import { CADENCE_GOALS, type Format, formatOf } from "./catalog.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back "what to make next" looks. */
const NEXT_DAYS = 30;
const TITLE = 70;

export interface DigestPost {
  /** The `marketing.post` record id. */
  id: string;
  platform: Platform;
  title: string;
  format: Format;
  stage: string;
  published: Date;
  views: number;
  engaged: number;
  /** Average % of the video watched, 0..100, when the platform gave it. */
  viewPct: number | null;
  /** Visitors its own link sent to the site. */
  clicks: number;
}

export interface DigestInput {
  now: Date;
  posts: readonly DigestPost[];
  /** Thread comments we posted in the last 7 days, per platform. */
  threadComments?: Partial<Record<Platform, number>>;
}

export const scoreOfPost = (p: Pick<DigestPost, "views" | "engaged">) =>
  p.views > 0 ? (p.engaged / p.views) * 100 : 0;

const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const mean = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const quote = (t: string) => {
  const s = t.replace(/\s+/g, " ").trim();
  return `"${s.length > TITLE ? `${s.slice(0, TITLE - 1)}…` : s}"`;
};
const FORMAT_WORD: Record<Format, string> = {
  long: "long video",
  short: "Short",
  reel: "Reel",
  video: "video",
  carousel: "carousel",
  thread: "thread",
  post: "post",
};
const PLATFORM_WORD: Record<Platform, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  reddit: "Reddit",
  facebook: "Facebook",
} as Record<Platform, string>;

/** The numbers "moved" compares, each a week's summary of its posts. */
const MOVERS: ReadonlyArray<{
  label: string;
  of: (ps: readonly DigestPost[]) => number | null;
  unit: (n: number) => string;
}> = [
  { label: "Views per post", of: (ps) => median(ps.map((p) => p.views)), unit: one },
  {
    label: "Engagement per 100 views",
    of: (ps) => median(ps.filter((p) => p.views > 0).map(scoreOfPost)),
    unit: (n) => n.toFixed(1),
  },
  {
    label: "Average % viewed",
    of: (ps) => mean(ps.flatMap((p) => (p.viewPct === null ? [] : [p.viewPct]))),
    unit: (n) => `${n.toFixed(0)}%`,
  },
  {
    label: "Site clicks",
    of: (ps) => (ps.some((p) => p.clicks > 0) ? ps.reduce((a, p) => a + p.clicks, 0) : null),
    unit: one,
  },
];

function linesFor(
  posts: readonly DigestPost[],
  now: Date,
  goals: typeof CADENCE_GOALS,
  threadComments: Partial<Record<Platform, number>>,
  all: boolean,
): DigestLine[] {
  const t = now.getTime();
  const week = posts.filter((p) => p.published.getTime() >= t - 7 * DAY_MS);
  const prior = posts.filter(
    (p) => p.published.getTime() < t - 7 * DAY_MS && p.published.getTime() >= t - 14 * DAY_MS,
  );
  const lines: DigestLine[] = [];
  const where = (p: DigestPost) => (all ? `${PLATFORM_WORD[p.platform] ?? p.platform} ` : "");
  const ranked = week
    .filter((p) => p.views > 0)
    .sort((a, b) => scoreOfPost(b) - scoreOfPost(a) || b.views - a.views);
  const top = ranked[0];
  if (top)
    lines.push({
      kind: "top",
      text: `Top: ${where(top)}${FORMAT_WORD[top.format]} ${quote(top.title)}, ${scoreOfPost(top).toFixed(1)} per 100 views on ${top.views} views.`,
      post: top.id,
    });
  const bottom = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  if (bottom)
    lines.push({
      kind: "bottom",
      text: `Bottom: ${where(bottom)}${FORMAT_WORD[bottom.format]} ${quote(bottom.title)}, ${scoreOfPost(bottom).toFixed(1)} per 100 views on ${bottom.views} views.`,
      post: bottom.id,
    });
  if (!week.length) lines.push({ kind: "top", text: "Nothing published this week." });

  let moved: {
    label: string;
    now: number;
    before: number;
    change: number;
    unit: (n: number) => string;
  } | null = null;
  for (const m of MOVERS) {
    const a = m.of(week);
    const b = m.of(prior);
    if (a === null || b === null || b === 0) continue;
    const change = (a - b) / b;
    if (!moved || Math.abs(change) > Math.abs(moved.change))
      moved = { label: m.label, now: a, before: b, change, unit: m.unit };
  }
  if (moved && Math.round(moved.change * 100) !== 0)
    lines.push({
      kind: "moved",
      text: `${moved.label} ${moved.change > 0 ? "up" : "down"} ${Math.abs(Math.round(moved.change * 100))}%: ${moved.unit(moved.now)} against ${moved.unit(moved.before)} the week before.`,
    });

  // Next: the format and stage with the best median score over 30 days; two posts beat one.
  const recent = posts.filter(
    (p) => p.published.getTime() >= t - NEXT_DAYS * DAY_MS && p.views > 0,
  );
  const shapes = new Map<string, DigestPost[]>();
  for (const p of recent) {
    const k = `${all ? p.platform : ""}|${p.format}|${p.stage}`;
    shapes.set(k, [...(shapes.get(k) ?? []), p]);
  }
  const best = [...shapes.values()]
    .map((ps) => ({ ps, score: median(ps.map(scoreOfPost)) ?? 0 }))
    .sort((a, b) => Number(b.ps.length > 1) - Number(a.ps.length > 1) || b.score - a.score)[0];
  if (best?.ps[0]) {
    const p = best.ps[0];
    const hours = new Map<number, number[]>();
    for (const q of best.ps) {
      const h = q.published.getUTCHours();
      hours.set(h, [...(hours.get(h) ?? []), scoreOfPost(q)]);
    }
    const hour = [...hours.entries()].sort(
      (a, b) => (median(b[1]) ?? 0) - (median(a[1]) ?? 0),
    )[0]?.[0];
    const at = hour === undefined ? "" : ` around ${String(hour).padStart(2, "0")}:00 UTC`;
    lines.push({
      kind: "next",
      text: `Next: another ${where(p)}${FORMAT_WORD[p.format]} for the ${p.stage} stage${at}. That shape leads with ${best.score.toFixed(1)} per 100 views over ${best.ps.length} post${best.ps.length === 1 ? "" : "s"} in ${NEXT_DAYS} days.`,
    });
  }

  for (const g of goals) {
    const done =
      g.counts === "thread_comment"
        ? (threadComments[g.platform] ?? 0)
        : week.filter(
            (p) => p.platform === g.platform && (g.counts === "any" || p.format === g.counts),
          ).length;
    lines.push({ kind: "cadence", text: `${g.label}: ${done} of ${g.goal} this week.` });
  }
  return lines;
}

/** Each platform's digest that has posts or goals, and one for all of them. */
export function buildDigest(input: DigestInput): Map<Platform | "all", DigestLine[]> {
  const out = new Map<Platform | "all", DigestLine[]>();
  const tc = input.threadComments ?? {};
  for (const platform of PLATFORMS) {
    const mine = input.posts.filter((p) => p.platform === platform);
    const goals = CADENCE_GOALS.filter((g) => g.platform === platform);
    if (!mine.length && !goals.length) continue;
    out.set(platform, linesFor(mine, input.now, goals, tc, false));
  }
  out.set("all", linesFor(input.posts, input.now, CADENCE_GOALS, tc, true));
  return out;
}

/** The last 30 days of posts with their latest numbers, and the week's thread comments. */
export async function digestInput(db: Queryable, now: Date): Promise<DigestInput> {
  const since = new Date(now.getTime() - NEXT_DAYS * DAY_MS).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const rows = (await db.execute(sql`
    select concat_ws('/', d.idea_id, d.platform, d.id) id, d.platform::text platform,
      coalesce(d.title, left(split_part(d.text, chr(10), 1), 120)) title,
      ${sql.raw(formatSql)} format, d.stage::text stage, d.published_at published,
      coalesce(m.views, 0)::int views,
      coalesce(m.reactions + m.comments + m.shares, 0)::int engaged,
      (select v.value from post_metric_days v where v.draft_id = d.id and v.metric = 'avg_view_pct'
        and v.key = '' order by v.day desc limit 1) view_pct,
      coalesce((select sum(l.clicks)::int from link_days l
        where l.content = left(d.id::text, 8)), 0) clicks
    from content_drafts d
    left join lateral (select c.views, c.reactions, c.comments, c.shares from content_metrics c
      where c.draft_id = d.id order by c.created_at desc limit 1) m on true
    where d.status = 'published' and d.published_at >= ${since}::timestamptz
      and d.published_at <= ${now.toISOString()}::timestamptz`)) as unknown as Array<{
    id: string;
    platform: Platform;
    title: string;
    format: Format;
    stage: string;
    published: string | Date;
    views: number;
    engaged: number;
    view_pct: number | null;
    clicks: number;
  }>;
  const [threads] = (await db.execute(sql`
    select count(*)::int n from reddit_threads
    where answer_ref is not null and answered_at >= ${weekAgo}::timestamptz
      and answered_at <= ${now.toISOString()}::timestamptz`)) as unknown as Array<{ n: number }>;
  return {
    now,
    posts: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      title: r.title,
      format: r.format,
      stage: r.stage,
      published: new Date(r.published),
      views: Number(r.views),
      engaged: Number(r.engaged),
      viewPct: r.view_pct === null ? null : Number(r.view_pct),
      clicks: Number(r.clicks),
    })),
    threadComments: { reddit: threads?.n ?? 0 },
  };
}

/** Build and keep `week`'s digests; a second run the same week replaces them. */
export async function writeDigest(db: Queryable, now: Date, week: string): Promise<boolean> {
  const built = buildDigest(await digestInput(db, now));
  const rows = [...built.entries()].map(([platform, lines]) => ({ week, platform, lines }));
  await db
    .insert(contentDigests)
    .values(rows)
    .onConflictDoUpdate({
      target: [contentDigests.week, contentDigests.platform],
      set: { lines: sql.raw("excluded.lines"), createdAt: sql`now()` },
    });
  return rows.length > 0;
}

/** The latest digest's lines for a platform: what the drafts' prompts read. */
export async function latestDigest(
  db: Queryable,
  platform: Platform | "all",
): Promise<DigestLine[]> {
  const [row] = await db
    .select({ lines: contentDigests.lines })
    .from(contentDigests)
    .where(sql`${contentDigests.platform} = ${platform}`)
    .orderBy(desc(contentDigests.week))
    .limit(1);
  return row?.lines ?? [];
}

/** A draft's format, for callers holding the row. */
export const draftFormat = (d: Pick<ContentDraft, "platform" | "extra">): Format =>
  formatOf(d.platform, typeof d.extra?.kind === "string" ? d.extra.kind : null);
