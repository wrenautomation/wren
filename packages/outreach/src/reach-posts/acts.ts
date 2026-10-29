/** His calls on a post (comment, like, follow, skip) and the likes and follows sent with no yes. */

import { keepSentEdit } from "@wren/core/ask";
import { type CapHolds, capHeld, holdCap, SiteCallError, untilUtcDay } from "@wren/core/content";
import { recordDraft } from "@wren/core/draft-record";
import type { RejectReason } from "@wren/core/reject-reasons";
import type { Queryable } from "@wren/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ReachRefusal } from "../refusal.js";
import { type ReachPost, type ReachPostPlatform, reachPosts } from "../schema.js";
import { keepTouch, touchesFromReachPost } from "../touches.js";
import type { CommentsSettings } from "./settings.js";

/** What refuses a comment before the platform is asked. */
export async function planPostComment(db: Queryable, id: number): Promise<ReachPost> {
  const [p] = await db.select().from(reachPosts).where(eq(reachPosts.id, id));
  if (!p) throw new ReachRefusal(`no post ${id}`);
  if (p.state === "commented") throw new ReachRefusal("already commented");
  if (p.state !== "queued") throw new ReachRefusal(`that post is ${p.state}`);
  return p;
}

/**
 * A like or follow on its own, without a comment: any post not skipped. One already done is
 * refused, so a second click never sends twice.
 */
export async function planPostAct(
  db: Queryable,
  id: number,
  act: "like" | "follow",
): Promise<ReachPost> {
  const [p] = await db.select().from(reachPosts).where(eq(reachPosts.id, id));
  if (!p) throw new ReachRefusal(`no post ${id}`);
  if (p.state === "skipped") throw new ReachRefusal("that post was skipped");
  if (act === "like" ? p.likedAt : p.followedAt)
    throw new ReachRefusal(act === "like" ? "already liked" : "already following");
  return p;
}

/** Commented: the words kept, his changes kept as an edit, the training record's `sent`. */
export async function markPostCommented(
  db: Queryable,
  post: ReachPost,
  r: { body: string; by: string; now: Date },
): Promise<void> {
  await db
    .update(reachPosts)
    .set({ state: "commented", comment: r.body, commentedAt: r.now, commentedBy: r.by })
    .where(eq(reachPosts.id, post.id));
  await keepTouch(`rp:${post.id}`, () => touchesFromReachPost(db, post.id));
  await keepSentEdit(db, {
    record: "onpost",
    id: String(post.id),
    by: r.by,
    before: post.draft,
    after: r.body,
  });
  await recordDraft(db, {
    item: `onpost:${post.id}`,
    kind: "post_comment",
    platform: post.platform,
    event: "sent",
    via: "person",
    by: r.by,
    text: r.body,
    externalId: post.ref,
    url: post.url,
    ref: `sent:onpost:${post.id}`,
  });
}

/** A UWaterloo tie: the school by name, or Waterloo with a program or class year. */
const WATERLOO =
  /\b(uwaterloo|university of waterloo|uw ?(se|cs|eng|math)|(se|syde|cs|tron|mech|eng) ?'? ?(29|2029))\b|\bwaterloo\b[\s\S]{0,60}\b(student|software eng\w*|se|cs|'? ?29|2029|co-?op)\b|\b(student|software eng\w*|se|cs|'? ?29|2029|co-?op)\b[\s\S]{0,60}\bwaterloo\b/i;

/**
 * An author in his own circle on Meta: a UWaterloo student (his 2029 SE class most of all).
 * Instagram and Threads get no follow or like from them, so his own feed and suggestions stay
 * apart from Wren's (William, 10-26). X takes them.
 */
export function ownCircle(
  p: Pick<ReachPost, "platform" | "handle" | "author" | "headline" | "text">,
): boolean {
  if (p.platform !== "instagram" && p.platform !== "threads") return false;
  return WATERLOO.test([p.handle, p.author, p.headline, p.text].filter(Boolean).join("\n"));
}

/** A site call: site, method, path, body. */
type SiteAct = readonly [string, "POST", string, Record<string, unknown>];

/** Follow a person (or, on LinkedIn, a company page): the one site call, from a post or People. */
export function followAct(
  platform: ReachPostPlatform,
  who: { handle: string } | { company: string },
): SiteAct {
  if ("company" in who)
    return ["linkedin", "POST", `/company/${who.company}/follow`, { company: who.company }];
  const h = who.handle;
  switch (platform) {
    case "linkedin":
      return ["linkedin", "POST", `/in/${h}/follow`, { vanity: h }];
    case "x":
      return ["x", "POST", "/2/users/me/following", { username: h }];
    case "instagram":
      return ["instagram", "POST", `/web/${h}/follow`, { username: h }];
    case "youtube":
      return [
        "youtube",
        "POST",
        "/youtube/v3/subscriptions",
        { snippet: { resourceId: { channelId: h } } },
      ];
    case "tiktok":
      return ["tiktok", "POST", `/web/${h}/follow`, { username: h }];
    case "threads":
      return ["instagram", "POST", `/web/threads/${h}/follow`, { username: h }];
  }
}

/**
 * What goes with his Comment: the comment itself where it is a site call (Instagram; LinkedIn and
 * X reply through the content channel), a like on the post, a follow of its author. Each runs as
 * the settings' account; a like or follow the settings leave off, or one already done, is null.
 */
export function postActs(
  p: ReachPost,
  s: Pick<CommentsSettings, "like" | "follow">,
  body: string,
): { comment: SiteAct | null; like: SiteAct | null; follow: SiteAct | null } {
  const ref = encodeURIComponent(p.ref);
  const h = p.handle;
  const company = p.platform === "linkedin" ? companyOf(p.authorUrl) : null;
  const kept = !ownCircle(p);
  const like = kept && s.like && !p.likedAt;
  const follow = kept && s.follow && !p.followedAt && (h || company);
  switch (p.platform) {
    case "linkedin":
      return {
        comment: null,
        like: like ? ["linkedin", "POST", `/feed/update/${ref}/like`, { urn: p.ref }] : null,
        follow: !follow
          ? null
          : followAct("linkedin", company ? { company } : { handle: h as string }),
      };
    case "x":
      return {
        comment: null,
        like: like ? ["x", "POST", "/2/users/me/likes", { id: p.ref }] : null,
        follow: follow && h ? followAct("x", { handle: h }) : null,
      };
    case "instagram":
      return {
        comment: ["instagram", "POST", `/web/p/${ref}/comments`, { shortcode: p.ref, text: body }],
        like: like ? ["instagram", "POST", `/web/p/${ref}/like`, { shortcode: p.ref }] : null,
        follow: follow && h ? followAct("instagram", { handle: h }) : null,
      };
    case "youtube":
      return {
        comment: [
          "youtube",
          "POST",
          "/youtube/v3/commentThreads",
          { snippet: { videoId: p.ref, topLevelComment: { snippet: { textOriginal: body } } } },
        ],
        like: like ? ["youtube", "POST", "/youtube/v3/videos/rate", { id: p.ref }] : null,
        follow: follow && h ? followAct("youtube", { handle: h }) : null,
      };
    case "tiktok": {
      const video = { videoId: p.ref, ...(h ? { username: h } : {}) };
      return {
        comment: ["tiktok", "POST", `/web/videos/${ref}/comments`, { ...video, text: body }],
        like: like ? ["tiktok", "POST", `/web/videos/${ref}/like`, video] : null,
        follow: follow && h ? followAct("tiktok", { handle: h }) : null,
      };
    }
    case "threads": {
      // A Threads post's page sits under its author: no handle, no act.
      if (!h) return { comment: null, like: null, follow: null };
      const post = { username: h, code: p.ref };
      const at = `/web/threads/${encodeURIComponent(h)}/post/${ref}`;
      return {
        comment: ["instagram", "POST", `${at}/reply`, { ...post, text: body }],
        like: like ? ["instagram", "POST", `${at}/like`, post] : null,
        follow: follow ? followAct("threads", { handle: h }) : null,
      };
    }
  }
}

/** Likes and follows of each kind a pass sends at most, under autobrowse's day caps. */
export const ACTS_PER_PASS = 5;
/** Posts older than this get no like or follow. */
const ACT_DAYS = 7;
/** Failed tries before a post's act is parked; a follow parks for its author. */
export const ACT_TRIES = 2;
/** Failures in a row in one pass that hold the act for the day: the flow, not the post, is broken. */
export const ACT_BREAK = 3;
/** autobrowse's answer when the profile is busy: nothing reached the site. */
const PROFILE_BUSY = 503;

/** The HTTP status of a site call's failure, also when Restate carried it as words. */
const statusOf = (err: unknown): number | null => {
  if (err instanceof SiteCallError) return err.status;
  const m = /: (\d{3}) /.exec(err instanceof Error ? err.message : String(err));
  return m ? Number(m[1]) : null;
};

export interface ActsStats {
  liked: number;
  followed: number;
  /** Acts whose day's cap is used: they wait for the reset. */
  held: string[];
  errors: string[];
}

/**
 * Likes on fit posts and follows of their authors, with no yes (William, 2026-10-25): a like or
 * follow has no words. A post fits at `minFit`; job ads and posts off target are dropped, never
 * acted on. An author already followed through another post is not asked again. A used cap
 * (`holds`, key `<platform> <act>`) ends that act till its reset. A failed act counts on its post
 * and parks at `ACT_TRIES`; `ACT_BREAK` failures in a row, or a sign-in or block, hold the act for
 * the day (designs/2026-10-29-act-parking.md).
 */
export async function autoActs(
  db: Queryable,
  o: {
    platform: ReachPostPlatform;
    settings: Pick<CommentsSettings, "like" | "follow" | "minFit">;
    call: (act: SiteAct) => Promise<unknown>;
    step: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
    holds: CapHolds;
    now: Date;
    /** Follows still free today (the ramped day cap less today's); none = only the pass cap. */
    followsLeft?: number;
  },
): Promise<ActsStats> {
  const stats: ActsStats = { liked: 0, followed: 0, held: [], errors: [] };
  const t = o.now.getTime();
  const key = (act: "like" | "follow") => `${o.platform} ${act}`;
  const on = {
    like: o.settings.like && !capHeld(o.holds, key("like"), t),
    follow: o.settings.follow && !capHeld(o.holds, key("follow"), t) && (o.followsLeft ?? 1) > 0,
  };
  const followCap = Math.min(ACTS_PER_PASS, o.followsLeft ?? ACTS_PER_PASS);
  if (!on.like && !on.follow) return stats;
  // One journaled read: a replay acts on the same posts whatever the table holds by then.
  const due = await o.step(`acts due ${o.platform}`, async () => {
    const rows = (await db.execute(sql`
      SELECT p.id, p.liked_at IS NULL AND p.like_fails < ${ACT_TRIES} AS "toLike",
        p.followed_at IS NULL AND NOT EXISTS (SELECT 1 FROM reach_posts f
          WHERE f.platform = p.platform
            AND (f.followed_at IS NOT NULL OR f.follow_fails >= ${ACT_TRIES})
            AND coalesce(f.handle, f.author_url) = coalesce(p.handle, p.author_url)) AS "toFollow"
      FROM reach_posts p
      WHERE p.platform = ${o.platform} AND p.fit >= ${o.settings.minFit}
        AND p.state IN ('found', 'queued', 'commented')
        AND p.created_at > ${new Date(t - ACT_DAYS * 86_400_000).toISOString()}::timestamptz
        AND ((p.liked_at IS NULL AND p.like_fails < ${ACT_TRIES}) OR p.followed_at IS NULL)
      ORDER BY p.fit DESC, p.id`)) as unknown as Array<{
      id: number;
      toLike: boolean;
      toFollow: boolean;
    }>;
    if (!rows.length) return [];
    const byId = new Map(
      (
        await db
          .select()
          .from(reachPosts)
          .where(
            inArray(
              reachPosts.id,
              rows.map((r) => r.id),
            ),
          )
      ).map((p) => [p.id, p]),
    );
    return rows.flatMap((r) => {
      const p = byId.get(r.id);
      return p ? [{ ...r, p }] : [];
    });
  });
  const followed = new Set<string>();
  const streak = { like: 0, follow: 0 };
  const holdDay = (what: "like" | "follow") => {
    o.holds[key(what)] = Math.max(o.holds[key(what)] ?? 0, t + untilUtcDay(t));
    on[what] = false;
    stats.held.push(key(what));
  };
  for (const { p, toLike, toFollow } of due) {
    const who = p.handle ?? p.authorUrl ?? "";
    const want = {
      like: on.like && toLike && stats.liked < ACTS_PER_PASS,
      follow: on.follow && toFollow && !followed.has(who) && stats.followed < followCap,
    };
    const acts = postActs(p, want, "");
    for (const what of ["like", "follow"] as const) {
      const act = acts[what];
      if (!act || !on[what]) continue;
      try {
        await o.call(act);
        await o.step(`${what} ${p.id}`, () => markPostActed(db, p.id, what, o.now));
        streak[what] = 0;
        if (what === "like") stats.liked++;
        else {
          stats.followed++;
          followed.add(who);
        }
      } catch (err) {
        if (holdCap(o.holds, key(what), err, t)) {
          on[what] = false;
          stats.held.push(key(what));
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        stats.errors.push(`${what} ${p.id}: ${message}`);
        const status = statusOf(err);
        if (status === PROFILE_BUSY) continue;
        // a pace or other refusal: nothing reached the site, and the next post meets it too
        if (status === 429) {
          on[what] = false;
          continue;
        }
        await o.step(`${what} failed ${p.id}`, () => markActFailed(db, p.id, what, message));
        if (what === "follow") followed.add(who);
        // a sign-in wall or a block is the account's, not this post's
        const account =
          err instanceof SiteCallError &&
          (err.code === "need_login" || err.code === "platform_blocked");
        if (account || ++streak[what] >= ACT_BREAK) holdDay(what);
      }
    }
  }
  return stats;
}

const companyOf = (url: string | null) =>
  url ? (/linkedin\.com\/company\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase() ?? null) : null;

/** A like or follow failed: one more try spent on the post, its words kept. */
export async function markActFailed(
  db: Queryable,
  id: number,
  act: "like" | "follow",
  error: string,
): Promise<void> {
  await db
    .update(reachPosts)
    .set({
      ...(act === "like"
        ? { likeFails: sql`${reachPosts.likeFails} + 1` }
        : { followFails: sql`${reachPosts.followFails} + 1` }),
      actError: error.slice(0, 500),
    })
    .where(eq(reachPosts.id, id));
}

/** Our like or follow went out: kept on the post and as a touch. */
export async function markPostActed(
  db: Queryable,
  id: number,
  act: "like" | "follow",
  now: Date,
): Promise<void> {
  await db
    .update(reachPosts)
    .set(act === "like" ? { likedAt: now } : { followedAt: now })
    .where(eq(reachPosts.id, id));
  await keepTouch(`rp:${id}:${act}`, () => touchesFromReachPost(db, id));
}

/** His no (or whoever `by` names): skipped; a draft turned down is kept with the why. */
export async function skipPost(
  db: Queryable,
  ids: readonly number[],
  o: { by?: string; reason?: RejectReason | null; note?: string | null } = {},
): Promise<number[]> {
  if (!ids.length) return [];
  const rows = await db
    .update(reachPosts)
    .set({ state: "skipped", stateReason: "skipped in To approve" })
    .where(and(inArray(reachPosts.id, [...ids]), inArray(reachPosts.state, ["found", "queued"])))
    .returning({ id: reachPosts.id, platform: reachPosts.platform, draft: reachPosts.draft });
  for (const r of rows)
    if (r.draft)
      await recordDraft(db, {
        item: `onpost:${r.id}`,
        kind: "post_comment",
        platform: r.platform,
        event: "rejected",
        via: "person",
        by: o.by ?? null,
        text: r.draft,
        reason: o.reason ?? null,
        note: o.note ?? null,
      });
  return rows.map((r) => r.id);
}

/** Posts by state, newest first, for the CLI. */
export async function listPosts(db: Queryable, o: { state?: string; limit?: number } = {}) {
  return db
    .select({
      id: reachPosts.id,
      platform: reachPosts.platform,
      state: reachPosts.state,
      author: reachPosts.author,
      fit: reachPosts.fit,
      why: reachPosts.why,
      draft: reachPosts.draft,
      url: reachPosts.url,
      foundBy: reachPosts.foundBy,
    })
    .from(reachPosts)
    .where(o.state ? eq(reachPosts.state, o.state as ReachPost["state"]) : undefined)
    .orderBy(desc(reachPosts.id))
    .limit(Math.min(o.limit ?? 30, 200));
}
