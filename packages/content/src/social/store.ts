/**
 * What SocialWatch keeps (designs/2026-10-06-social-inbox.md): comments on our recent posts as
 * `comments` rows (`channel = content`), activity as `social_activity`, and one follower count per
 * platform per day in `social_days`. Every write is idempotent on the platform's id.
 */
import type { ActivityRow, Audience, CommentRow, Platform } from "@wren/core/content";
import { plural } from "@wren/core/notify";
import type { Queryable } from "@wren/db";
import { askedInWords, type Comment, comments } from "@wren/outreach";
import { keepTouch, touchFromAnswer, touchFromComment } from "@wren/outreach/touches";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { keepLive } from "../analytics/store.js";
import { contentDrafts, socialActivity, socialDays } from "../schema.js";
import { touchFromActivity } from "../touches.js";

const DAY = 86_400_000;
/** Posts this young are read for comments. */
export const RECENT_DAYS = 14;
/** Older than this, a post is read every `SLOW_EVERY_MS`, not every pass. */
export const FRESH_DAYS = 3;
export const SLOW_EVERY_MS = 2 * 60 * 60 * 1000;

export interface RecentPost {
  platform: Platform;
  /** The platform's post id. */
  id: string;
  url: string | null;
  title: string;
  publishedAt: string;
}

/** Posts published in the last `RECENT_DAYS` on these platforms, newest first. */
export async function recentPosts(
  db: Queryable,
  platforms: readonly Platform[],
  now: Date,
): Promise<RecentPost[]> {
  if (!platforms.length) return [];
  const rows = await db
    .select({
      platform: contentDrafts.platform,
      id: contentDrafts.publishedId,
      url: contentDrafts.url,
      title: contentDrafts.title,
      text: contentDrafts.text,
      publishedAt: contentDrafts.publishedAt,
    })
    .from(contentDrafts)
    .where(
      and(
        inArray(contentDrafts.platform, [...platforms]),
        isNotNull(contentDrafts.publishedId),
        gte(contentDrafts.publishedAt, new Date(now.getTime() - RECENT_DAYS * DAY)),
      ),
    )
    .orderBy(desc(contentDrafts.publishedAt));
  return rows.flatMap((r) =>
    r.id && r.publishedAt
      ? [
          {
            platform: r.platform,
            id: r.id,
            url: r.url,
            title: (r.title ?? r.text.split("\n")[0] ?? "").slice(0, 200),
            publishedAt: r.publishedAt.toISOString(),
          },
        ]
      : [],
  );
}

/**
 * How often a post's comments are read: young, then older. TikTok's come off its page in a
 * browser, 24 a day, so its posts are read every 6 hours while young and daily after.
 */
const EVERY: Partial<Record<Platform, { fresh: number; slow: number }>> = {
  tiktok: { fresh: 6 * 60 * 60 * 1000, slow: DAY },
};

/** Young posts every pass; older ones once per `SLOW_EVERY_MS` since their last read. */
export const isDue = (p: RecentPost, lastRead: number | undefined, now: Date): boolean => {
  const since = now.getTime() - (lastRead ?? 0);
  const young = now.getTime() - new Date(p.publishedAt).getTime() <= FRESH_DAYS * DAY;
  const every = EVERY[p.platform];
  if (every) return since >= (young ? every.fresh : every.slow);
  return young || since >= SLOW_EVERY_MS;
};

export type KeptComment = Pick<Comment, "id" | "platform" | "author" | "post"> & {
  asked: boolean;
};

/**
 * Keep a post's comments; a re-read keeps nothing twice. Ours are kept and closed. Answers the new
 * comments from other people, oldest first, each marked when its words ask for something.
 */
export async function keepPostComments(
  db: Queryable,
  post: RecentPost,
  rows: readonly CommentRow[],
): Promise<KeptComment[]> {
  if (!rows.length) return [];
  const values = [...rows]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((c) => {
      const reply = !!c.parentId && c.parentId !== post.id;
      return {
        platform: post.platform,
        channel: "content" as const,
        accountId: null,
        ref: c.id.slice(0, 200),
        post: post.id.slice(0, 200),
        parent: (reply ? (c.parentId as string) : post.id).slice(0, 200),
        kind: reply ? ("comment_reply" as const) : ("post_reply" as const),
        place: null,
        postTitle: post.title,
        author: c.author.slice(0, 120),
        body: c.text,
        url: c.url ?? post.url ?? "",
        at: new Date(c.at),
        raw: c.raw ?? c,
        ...(c.mine ? { sort: "ours" as const, state: "dropped" as const, why: "One of ours" } : {}),
      };
    });
  const kept = await db.insert(comments).values(values).onConflictDoNothing().returning({
    id: comments.id,
    platform: comments.platform,
    author: comments.author,
    post: comments.post,
    body: comments.body,
    sort: comments.sort,
  });
  const theirs = kept
    .filter((k) => k.sort !== "ours")
    .map(({ sort: _, body, ...k }) => ({ ...k, asked: askedInWords(body) }))
    .sort((a, b) => a.id - b.id);
  for (const k of theirs) await keepTouch(`c:${k.id}`, () => touchFromComment(db, k.id));
  await answeredByHand(db, post, rows);
  return theirs;
}

/**
 * Our reply under their comment, made on the platform by hand (a TikTok reply has no API): their
 * comment counts as answered at our reply's time, so the reply rate counts it like any other.
 */
async function answeredByHand(db: Queryable, post: RecentPost, rows: readonly CommentRow[]) {
  for (const c of rows) {
    if (!c.mine || !c.parentId || c.parentId === post.id) continue;
    const [k] = await db
      .update(comments)
      .set({
        state: "answered",
        answer: c.text,
        answerRef: c.id.slice(0, 200),
        answeredAt: new Date(c.at),
      })
      .where(
        and(
          eq(comments.platform, post.platform),
          eq(comments.ref, c.parentId.slice(0, 200)),
          isNull(comments.answeredAt),
          sql`${comments.sort} is distinct from 'ours'`,
        ),
      )
      .returning({ id: comments.id });
    if (k) await keepTouch(`ca:${k.id}`, () => touchFromAnswer(db, k.id));
  }
}

/**
 * Reviews of the account (Business Profile) as comments on its place: `post` is the location, so
 * the Inbox threads them like any comment and an answer goes back through `reply`.
 */
export async function keepReviews(
  db: Queryable,
  platform: Platform,
  rows: readonly CommentRow[],
  now: Date,
): Promise<KeptComment[]> {
  const kept: KeptComment[] = [];
  for (const place of new Set(rows.map((r) => r.postId)))
    kept.push(
      ...(await keepPostComments(
        db,
        { platform, id: place, url: null, title: "Reviews", publishedAt: now.toISOString() },
        rows.filter((r) => r.postId === place),
      )),
    );
  return kept;
}

/** The newest kept activity time on the platform: the next read starts there. */
export async function newestActivityAt(db: Queryable, platform: Platform): Promise<string | null> {
  const [row] = await db
    .select({ at: socialActivity.at })
    .from(socialActivity)
    .where(eq(socialActivity.platform, platform))
    .orderBy(desc(socialActivity.at))
    .limit(1);
  return row?.at.toISOString() ?? null;
}

/** Keep activity rows once each; a row with no time takes `now`. Answers the new ones. */
export async function keepActivity(
  db: Queryable,
  platform: Platform,
  rows: readonly ActivityRow[],
  now: Date,
): Promise<Array<{ id: number; kind: ActivityRow["kind"] }>> {
  if (!rows.length) return [];
  const kept = await db
    .insert(socialActivity)
    .values(
      rows.map((a) => ({
        platform,
        kind: a.kind,
        ref: a.id.slice(0, 200),
        actor: a.actor,
        actorUrl: a.actorUrl,
        text: a.text,
        url: a.url,
        at: a.at ? new Date(a.at) : now,
        raw: a.raw ?? a,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: socialActivity.id, kind: socialActivity.kind });
  for (const k of kept) await keepTouch(`sa:${k.id}`, () => touchFromActivity(db, k.id));
  return kept;
}

/** Whether the platform's count for `day` is already kept. */
export async function hasDay(db: Queryable, platform: Platform, day: string): Promise<boolean> {
  const [row] = await db
    .select({ day: socialDays.day })
    .from(socialDays)
    .where(and(eq(socialDays.platform, platform), eq(socialDays.day, day)));
  return !!row;
}

/** The day's follower count; the first read of the day stays, unless `latest` (a read on demand). */
export async function keepDay(
  db: Queryable,
  platform: Platform,
  day: string,
  a: Audience,
  latest = false,
): Promise<boolean> {
  const row = { followers: Math.max(0, Math.round(a.followers)), raw: a.raw ?? a };
  const insert = db.insert(socialDays).values({ platform, day, ...row });
  const kept = await (latest
    ? insert.onConflictDoUpdate({ target: [socialDays.platform, socialDays.day], set: row })
    : insert.onConflictDoNothing()
  ).returning({ day: socialDays.day });
  // The catalog's Followers row reads live from here on (designs/2026-10-07-content-analytics.md).
  const at = new Date(a.asOf);
  if (kept.length)
    await keepLive(db, platform, ["account.followers"], Number.isNaN(+at) ? new Date() : at);
  return kept.length > 0;
}

/** Mark activity rows seen: these ids, or every new one when `ids` is null. */
export async function markSeen(db: Queryable, ids: readonly number[] | null): Promise<number> {
  if (ids && !ids.length) return 0;
  const done = await db
    .update(socialActivity)
    .set({ state: "seen" })
    .where(
      and(eq(socialActivity.state, "new"), ids ? inArray(socialActivity.id, [...ids]) : undefined),
    )
    .returning({ id: socialActivity.id });
  return done.length;
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  linkedin: "LinkedIn",
  reddit: "Reddit",
  youtube: "YouTube",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  google_business: "Business Profile",
};

const KIND_WORDS: Record<ActivityRow["kind"], [string, string]> = {
  follow: ["follow", "follows"],
  subscribe: ["subscribe", "subscribes"],
  mention: ["mention", "mentions"],
  reaction: ["reaction", "reactions"],
  notification: ["notification", "notifications"],
};

/** One line for the pass: "social: 3 comments (2 YouTube, 1 LinkedIn), 5 follows". Null = nothing kept. */
export function pingOf(
  kept: readonly Pick<KeptComment, "platform">[],
  activity: readonly { kind: ActivityRow["kind"] }[],
): string | null {
  const parts: string[] = [];
  if (kept.length) {
    const by = new Map<string, number>();
    for (const c of kept) {
      const name = PLATFORM_NAMES[c.platform as Platform] ?? c.platform;
      by.set(name, (by.get(name) ?? 0) + 1);
    }
    const each = [...by].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${n} ${p}`);
    parts.push(`${plural(kept.length, "comment")} (${each.join(", ")})`);
  }
  const kinds = new Map<ActivityRow["kind"], number>();
  for (const a of activity) kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) {
    const [one, many] = KIND_WORDS[k];
    parts.push(plural(n, one, many));
  }
  return parts.length ? `social: ${parts.join(", ")}` : null;
}
