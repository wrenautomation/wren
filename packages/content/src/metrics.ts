/**
 * What a post did, as rows. `metricsDue` picks published drafts worth a look
 * (young enough, not looked at today); `recordMetrics` writes one snapshot;
 * `whatWorked` ranks a window's posts by engagement so the week's lesson is
 * a query. Learning from it (feeding winners back into ideas) is still a
 * person's job — see the design's "where to attack".
 */
import type { Metrics } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { and, desc, eq, gte, inArray, isNotNull, notExists } from "drizzle-orm";
import { type ContentDraft, type ContentMetric, contentDrafts, contentMetrics } from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Posts older than this are done moving; stop looking. */
export const DEFAULT_WATCH_DAYS = 30;
/** One look per post per day. */
export const DEFAULT_LOOK_EVERY_MS = 20 * 60 * 60 * 1000;

/**
 * Published drafts (with the platform's id) published within `watchDays`
 * whose last snapshot is older than `lookEveryMs` or missing. Oldest look first.
 */
export async function metricsDue(
  db: Queryable,
  now: Date,
  o: { watchDays?: number; lookEveryMs?: number; limit?: number } = {},
): Promise<ContentDraft[]> {
  const since = new Date(now.getTime() - (o.watchDays ?? DEFAULT_WATCH_DAYS) * DAY_MS);
  const stale = new Date(now.getTime() - (o.lookEveryMs ?? DEFAULT_LOOK_EVERY_MS));
  // A Date in raw `sql\`…\`` is not a postgres-js parameter; keep every comparison typed.
  const lookedRecently = db
    .select({ id: contentMetrics.id })
    .from(contentMetrics)
    .where(and(eq(contentMetrics.draftId, contentDrafts.id), gte(contentMetrics.createdAt, stale)));
  return db
    .select()
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.status, "published"),
        isNotNull(contentDrafts.publishedId),
        gte(contentDrafts.publishedAt, since),
        notExists(lookedRecently),
      ),
    )
    .orderBy(contentDrafts.publishedAt)
    .limit(o.limit ?? 50);
}

export async function recordMetrics(
  db: Queryable,
  draftId: string,
  m: Metrics,
): Promise<ContentMetric> {
  const [row] = await db
    .insert(contentMetrics)
    .values({
      draftId,
      asOf: new Date(m.asOf),
      views: m.views,
      reactions: m.reactions,
      comments: m.comments,
      shares: m.shares,
      fetchedWith: m.fetchedWith,
    })
    .returning();
  if (!row) throw new Error("content_metrics insert returned no row");
  return row;
}

export interface WorkedRow {
  draftId: string;
  platform: ContentDraft["platform"];
  ideaId: string;
  text: string;
  url: string | null;
  publishedAt: Date;
  views: number;
  reactions: number;
  comments: number;
  shares: number;
  asOf: Date;
  /** Engagements per 100 views (0 with no views): the rank key. */
  score: number;
  /** How many looks the row has: 1 = no curve yet. */
  looks: number;
}

export const scoreOf = (m: {
  views: number;
  reactions: number;
  comments: number;
  shares: number;
}) => (m.views > 0 ? ((m.reactions + m.comments + m.shares) / m.views) * 100 : 0);

/** Posts published in the last `days` with their latest snapshot, best score first. */
export async function whatWorked(
  db: Queryable,
  now: Date,
  o: { days?: number; platform?: ContentDraft["platform"] } = {},
): Promise<WorkedRow[]> {
  const since = new Date(now.getTime() - (o.days ?? 7) * DAY_MS);
  const drafts = await db
    .select()
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.status, "published"),
        gte(contentDrafts.publishedAt, since),
        ...(o.platform ? [eq(contentDrafts.platform, o.platform)] : []),
      ),
    );
  if (drafts.length === 0) return [];
  const snaps = await db
    .select()
    .from(contentMetrics)
    .where(
      inArray(
        contentMetrics.draftId,
        drafts.map((d) => d.id),
      ),
    )
    .orderBy(desc(contentMetrics.createdAt));
  const rows: WorkedRow[] = [];
  for (const d of drafts) {
    const mine = snaps.filter((s) => s.draftId === d.id);
    const latest = mine[0];
    if (!latest || !d.publishedAt) continue;
    rows.push({
      draftId: d.id,
      platform: d.platform,
      ideaId: d.ideaId,
      text: d.text,
      url: d.url,
      publishedAt: d.publishedAt,
      views: latest.views,
      reactions: latest.reactions,
      comments: latest.comments,
      shares: latest.shares,
      asOf: latest.asOf,
      score: scoreOf(latest),
      looks: mine.length,
    });
  }
  return rows.sort((a, b) => b.score - a.score || b.views - a.views);
}

const PREVIEW = 60;
const preview = (t: string) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > PREVIEW ? `${one.slice(0, PREVIEW - 1)}…` : one;
};

/** One line per post, best first; the report the notifier sends and the CLI prints. */
export function formatWhatWorked(rows: readonly WorkedRow[]): string[] {
  if (rows.length === 0) return ["no published posts with metrics in the window"];
  return rows.map(
    (r) =>
      `${r.score.toFixed(1)}/100 · ${r.platform} · ${r.views} views · ${r.reactions}+${r.comments}+${r.shares} · ${preview(r.text)}${r.url ? ` · ${r.url}` : ""}`,
  );
}
