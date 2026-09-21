/**
 * What the loop has learned for one platform, read fresh before each draft:
 * the author's recent redraft notes ("shorter", "keep the discord line") and
 * the posts that did best. Both go into the prompt as short lists, so a note
 * given once shapes the next idea too, and a winner's shape is copied. Read
 * only; the rows already exist (notes on redrafts, metrics snapshots).
 */
import type { Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { scoreOf } from "./metrics.js";
import { contentDrafts, contentMetrics } from "./schema.js";

export interface Lessons {
  /** Distinct notes, newest first. */
  notes: string[];
  /** Best posts by engagement per 100 views, best first. */
  winners: { text: string; views: number; score: number }[];
}

export const NO_LESSONS: Lessons = { notes: [], winners: [] };
const MAX_NOTES = 5;
const MAX_WINNERS = 3;
const NOTE_CHARS = 200;
const WINNER_CHARS = 600;
/** A winner needs an audience: below this, the rank is noise. */
const MIN_VIEWS = 20;

export async function lessonsFor(db: Queryable, platform: Platform): Promise<Lessons> {
  const noted = await db
    .select({ note: contentDrafts.note })
    .from(contentDrafts)
    .where(and(eq(contentDrafts.platform, platform), isNotNull(contentDrafts.note)))
    .orderBy(desc(contentDrafts.createdAt))
    .limit(50);
  const notes: string[] = [];
  for (const { note } of noted) {
    const n = (note ?? "").trim().slice(0, NOTE_CHARS);
    if (n && !notes.some((x) => x.toLowerCase() === n.toLowerCase())) notes.push(n);
    if (notes.length === MAX_NOTES) break;
  }

  const snaps = await db
    .select({
      draftId: contentMetrics.draftId,
      text: contentDrafts.text,
      views: contentMetrics.views,
      reactions: contentMetrics.reactions,
      comments: contentMetrics.comments,
      shares: contentMetrics.shares,
      at: contentMetrics.createdAt,
    })
    .from(contentMetrics)
    .innerJoin(contentDrafts, eq(contentDrafts.id, contentMetrics.draftId))
    .where(and(eq(contentDrafts.platform, platform), eq(contentDrafts.status, "published")))
    .orderBy(desc(contentMetrics.createdAt))
    .limit(500);
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.draftId)) latest.set(s.draftId, s);
  const winners = [...latest.values()]
    .filter((s) => s.views >= MIN_VIEWS)
    .map((s) => ({ text: s.text.slice(0, WINNER_CHARS), views: s.views, score: scoreOf(s) }))
    .sort((a, b) => b.score - a.score || b.views - a.views)
    .slice(0, MAX_WINNERS);
  return { notes, winners };
}

/** The prompt section; "" when there is nothing learned yet. */
export function lessonsBlock(l: Lessons): string {
  const parts: string[] = [];
  if (l.notes.length)
    parts.push(
      `The author's notes on earlier drafts, newest first; follow them here too:\n${l.notes.map((n) => `- ${n}`).join("\n")}`,
    );
  if (l.winners.length)
    parts.push(
      `Posts of this kind that did best (engagement per 100 views); match their shape, not their words:\n${l.winners
        .map((w) => `- (${w.score.toFixed(1)}, ${w.views} views) """${w.text}"""`)
        .join("\n")}`,
    );
  return parts.length ? `\n${parts.join("\n\n")}\n` : "";
}
