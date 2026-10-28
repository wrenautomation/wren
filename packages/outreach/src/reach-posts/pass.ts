/**
 * Comments on others' posts on LinkedIn, X, Instagram, YouTube, TikTok and Threads
 * (designs/2026-10-07-posting-flow.md, item 4; designs/2026-10-07-reach-targeting.md). Each
 * platform has its own settings block (`<platform>.comments`); an empty account is off. Each six
 * hours, until the day's comments wait, the watch reads recent posts as that account (never his personal LinkedIn or the research alt):
 * topic searches, pages' posts, key people's posts. Code ranks them, the model drafts a comment
 * for the best few, and each waits in To approve (`queued`). Only his Comment posts it, then a
 * like on the post and a follow of its author when the settings ask, each a touch.
 *
 * Code keeps out what no buyer reads: job ads, posts with none of the audience's words (unless by
 * an owner in that world or someone we invited), and posts under the settings' minimum fit. A draft may claim only Wren's facts (`@wren/core/facts`); the
 * guard (`@wren/core/grounded`) redrafts a made-up claim or number once, then drops it.
 */

import { canonRef, resolveObjects } from "@wren/core/objects";
import type { OurPost } from "@wren/core/our-posts";
import { atomic, type Queryable } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { passedOn, passKey } from "../passes.js";
import { type ReachPostPlatform, reachAccounts, reachPosts } from "../schema.js";
import type { ActsStats } from "./acts.js";
import { draftPost } from "./draft.js";
import { MOMENTUM_MAX, momentum, rankPost } from "./rank.js";
import { type FeedPost, type KeyPerson, type PostReader, type Since, vanityOf } from "./read.js";
import type { CommentsSettings } from "./settings.js";
import { planTopics, proposeTopics, topicYields } from "./topics.js";

/**
 * Reads a pass, at most, under autobrowse's caps; a pass runs every six hours until the day's
 * comments wait (`watch.ts`). LinkedIn meters `posts` at 40 a day for linkedin@wren; X searches
 * 50; an Instagram search is one read plus a page per post, 10 searches a day. A YouTube search
 * costs 100 of the channel's 10,000 quota units a day, which uploads share (1,600 each). TikTok
 * and Threads search by page load: 20 and 10 a day.
 */
const READS_PER_PASS: Readonly<Record<ReachPostPlatform, number>> = {
  linkedin: 10,
  x: 10,
  instagram: 1,
  youtube: 3,
  tiktok: 2,
  threads: 2,
};

/** Instagram accounts read a pass through Graph's business discovery: an API call, no page load. */
const IG_GRAPH_PER_PASS = 8;

/** Key people read a pass, at most: each is one read. */
const PEOPLE_PER_PASS = 3;
/** One comment per author a week. */
const AUTHOR_GAP_MS = 7 * 86_400_000;
const HOUR = 3_600_000;

/**
 * Keep new posts once (by platform and ref): ranked, or dropped with why (too old, ours, too short, a job ad,
 * not the audience's world). A post already kept is left as it is. Returns the ids kept as `found`.
 * Each post is a platform object first (`resolveObjects`, three statements for the pass) and its row
 * keeps the ref that comes back. A post whose ref no rule reads is skipped.
 */
export async function keepPosts(
  db: Queryable,
  posts: readonly FeedPost[],
  o: {
    platform: ReachPostPlatform;
    foundBy: string;
    account: string;
    topics: readonly string[];
    audience?: readonly string[];
    key?: boolean;
    /** Our own handles on the platform, lowercased. */
    ours: readonly string[];
    halfLifeHours: number;
    maxAgeHours: number;
    now: Date;
  },
): Promise<{ found: number[]; dropped: number }> {
  const out = { found: [] as number[], dropped: 0 };
  const passed = await passedOn(db, o.platform);
  const readable = posts.filter((p) => {
    if (!p.ref) return false;
    try {
      canonRef(o.platform, "post", p.ref);
      return true;
    } catch {
      return false;
    }
  });
  if (!readable.length) return out;
  return atomic(db, async (tx) => {
    const handleOf = (p: FeedPost) =>
      p.handle ?? (o.platform === "linkedin" ? vanityOf(p.authorUrl) : null);
    const postedAtOf = (p: FeedPost) => {
      const at = p.at ? new Date(p.at) : null;
      return at && !Number.isNaN(at.getTime()) ? at : null;
    };
    const refs = await resolveObjects(
      tx,
      readable.map((p) => ({
        platform: o.platform,
        kind: "post" as const,
        raw: p.ref,
        url: p.url,
        author: handleOf(p),
        at: postedAtOf(p),
      })),
    );
    for (const p of readable) {
      const handle = handleOf(p);
      const postedAt = postedAtOf(p);
      const { fit, why, off } = rankPost(p, { ...o, key: o.key ?? false });
      const dropped =
        postedAt && o.now.getTime() - postedAt.getTime() > o.maxAgeHours * HOUR
          ? `older than ${o.maxAgeHours} hours`
          : handle && o.ours.includes(handle)
            ? "ours"
            : passed.has(passKey(handle, p.author)) || passed.has(passKey(null, p.author))
              ? "you passed on them"
              : p.text.trim().length < 40
                ? "too short to answer"
                : (p.off ?? off);
      const [row] = await tx
        .insert(reachPosts)
        .values({
          platform: o.platform,
          ref: refs.get(p.ref) ?? p.ref,
          author: p.author,
          authorUrl: p.authorUrl,
          handle,
          headline: p.headline ?? null,
          text: p.text,
          url: p.url,
          postedAt,
          reactions: p.reactions,
          comments: p.comments,
          foundBy: o.foundBy.slice(0, 200),
          account: o.account,
          fit,
          why,
          state: dropped ? "dropped" : "found",
          stateReason: dropped,
          raw: (p.raw ?? p) as Record<string, unknown>,
          createdAt: o.now,
        })
        .onConflictDoNothing({ target: [reachPosts.platform, reachPosts.ref] })
        .returning({ id: reachPosts.id, state: reachPosts.state });
      if (!row) continue;
      if (row.state === "found") out.found.push(row.id);
      else out.dropped++;
    }
    return out;
  });
}

/** One platform's comments queued in the last day: the cap counts them. */
async function queuedToday(db: Queryable, platform: ReachPostPlatform, now: Date): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reachPosts)
    .where(
      and(
        eq(reachPosts.platform, platform),
        gte(reachPosts.queuedAt, new Date(now.getTime() - 24 * HOUR)),
      ),
    );
  return r?.n ?? 0;
}

/**
 * The best found posts inside the guard and at the minimum fit now, one per author, none by an
 * author we queued or commented on this week. A post's fit was ranked when found: its timing
 * points are counted again at its age now, so a post that went quiet sinks. A post under the
 * minimum stays found: a lower minimum later can still pick it.
 */
async function postsToDraft(
  db: Queryable,
  limit: number,
  o: {
    platform: ReachPostPlatform;
    halfLifeHours: number;
    maxAgeHours: number;
    minFit: number;
    now: Date;
  },
): Promise<number[]> {
  if (limit <= 0) return [];
  const since = new Date(o.now.getTime() - o.maxAgeHours * HOUR).toISOString();
  const week = new Date(o.now.getTime() - AUTHOR_GAP_MS).toISOString();
  const rows = (await db.execute(sql`
    SELECT p.id, p.fit, p.posted_at, p.created_at, p.reactions, p.comments,
      coalesce(p.handle, p.author_url, p.author) AS who
    FROM reach_posts p
    WHERE p.platform = ${o.platform}
      AND p.state = 'found'
      AND p.fit >= ${o.minFit - MOMENTUM_MAX}
      AND coalesce(p.posted_at, p.created_at) >= ${since}
      AND NOT EXISTS (SELECT 1 FROM reach_posts q
        WHERE q.platform = p.platform
          AND coalesce(q.handle, q.author_url, q.author) = coalesce(p.handle, p.author_url, p.author)
          AND q.state IN ('queued', 'commented')
          AND coalesce(q.commented_at, q.queued_at) >= ${week})`)) as unknown as Array<{
    id: number;
    fit: number;
    posted_at: string | Date | null;
    created_at: string | Date;
    reactions: number;
    comments: number;
    who: string;
  }>;
  const ms = (d: string | Date) => new Date(d).getTime();
  const best = new Map<string, { id: number; fit: number }>();
  for (const r of rows) {
    const posted = r.posted_at === null ? null : ms(r.posted_at);
    const ageAt = (t: number) => (posted === null ? null : Math.max(0, (t - posted) / HOUR));
    const fit =
      r.fit -
      momentum(r, ageAt(ms(r.created_at)), o.halfLifeHours) +
      momentum(r, ageAt(o.now.getTime()), o.halfLifeHours);
    if (fit < o.minFit) continue;
    const had = best.get(r.who);
    if (!had || fit > had.fit || (fit === had.fit && r.id < had.id))
      best.set(r.who, { id: r.id, fit });
  }
  return [...best.values()]
    .sort((a, b) => b.fit - a.fit || a.id - b.id)
    .slice(0, limit)
    .map((r) => r.id);
}

/**
 * People we know on the platform, a few a day in turn. LinkedIn: accepted invites, then
 * engagers. X and Instagram: handles that touched us (replied, liked, mentioned, followed).
 * Instagram also: accounts in the trade its searches found (a post or bio with the audience's
 * words, any age), read fresh through Graph.
 */
async function keyPeople(
  db: Queryable,
  platform: ReachPostPlatform,
  now: Date,
  audience: readonly string[],
  limit = PEOPLE_PER_PASS,
): Promise<KeyPerson[]> {
  // A new draw each pass (passes run hours apart), so no one is read twice in a day.
  const seed = now.toISOString().slice(0, 13);
  const like = sql`ARRAY[${sql.join(
    audience.map((a) => sql`${`%${a.replace(/[%_\\]/g, "\\$&")}%`}`),
    sql`, `,
  )}]`;
  const trade =
    platform === "instagram" && audience.length
      ? sql`UNION
        SELECT DISTINCT lower(p.handle), p.author FROM reach_posts p
        WHERE p.platform = 'instagram' AND p.handle IS NOT NULL
          AND (p.text ILIKE ANY (${like}) OR p.headline ILIKE ANY (${like}))`
      : sql``;
  if (platform !== "linkedin")
    return (await db.execute(sql`
      SELECT handle, coalesce(name, handle) name FROM (
        SELECT DISTINCT h.handle, h.name FROM social_handles h
        JOIN touches t ON t.handle_id = h.id AND t.direction = 'theirs'
        WHERE h.platform = ${platform}
        ${trade}
      ) k WHERE handle ~ '^[a-z0-9._]{1,30}$'
      ORDER BY md5(handle || ${seed}) LIMIT ${limit}`)) as unknown as KeyPerson[];
  return (await db.execute(sql`
    SELECT vanity handle, name FROM (
      SELECT lower(c.handle) vanity, c.name FROM reach_contacts c
      WHERE c.platform = 'linkedin' AND c.state IN ('enrolled', 'connected') AND c.name IS NOT NULL
      UNION
      SELECT lower(substring(a.actor_url from 'linkedin\\.com/in/([^/?#]+)')), a.actor
      FROM social_activity a
      WHERE a.platform = 'linkedin' AND a.actor IS NOT NULL
        AND a.actor_url ~* 'linkedin\\.com/in/[^/?#]+'
        AND a.kind IN ('reaction', 'mention', 'follow')
    ) k WHERE vanity IS NOT NULL
    ORDER BY md5(vanity || ${seed}) LIMIT ${limit}`)) as unknown as KeyPerson[];
}

export interface PostsStats {
  platform: ReachPostPlatform;
  account: string;
  reads: number;
  kept: number;
  dropped: number;
  queued: number;
  /** Drafts put on spaced slots this pass (`autoSend`). */
  scheduled?: number;
  /** Likes and follows sent with no yes. */
  acts?: ActsStats;
  /** autobrowse's day's cap is used (a 429 waiting hours): reads end for the pass, no error. */
  capped: boolean;
  /** The search words this pass planned, and his own that rest for finding nothing on target. */
  topics: string[];
  rested: string[];
  errors: string[];
}

/**
 * One platform's day: read, keep, rank, draft up to the day's cap. `step` journals each table
 * write and model call (Restate's `ctx.run`); the reads are the desk's own journaled calls.
 */
export async function postsPass(
  db: Queryable,
  o: {
    platform: ReachPostPlatform;
    settings: CommentsSettings;
    read: PostReader;
    llm: LlmClient | null;
    guide?: () => Promise<string>;
    voice?: string;
    /** Wren's facts, read once a pass; left out, drafts claim nothing first-person. */
    facts?: () => Promise<readonly string[]>;
    /** What we've posted, read once a pass: what comments draw on. */
    ours?: () => Promise<readonly OurPost[]>;
    now: Date;
    step: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
    capped?: (err: unknown) => boolean;
  },
): Promise<PostsStats> {
  const s = o.settings;
  const platform = o.platform;
  const out: PostsStats = {
    platform,
    account: s.account,
    reads: 0,
    kept: 0,
    dropped: 0,
    queued: 0,
    capped: false,
    topics: [],
    rested: [],
    errors: [],
  };
  if (!s.account) return out;
  const need = s.perDay - (await o.step("queued today", () => queuedToday(db, platform, o.now)));
  // Our own: LinkedIn's reach logins; on X and Instagram, the socials connected for posting.
  const ours = await o.step("ours", async () =>
    platform === "linkedin"
      ? (
          await db
            .select({ handle: reachAccounts.handle })
            .from(reachAccounts)
            .where(and(eq(reachAccounts.platform, platform), isNotNull(reachAccounts.handle)))
        ).flatMap((a) => (a.handle ? [a.handle.toLowerCase()] : []))
      : (
          (await db.execute(
            sql`SELECT lower(handle) handle FROM social_connections WHERE platform = ${platform} AND handle IS NOT NULL`,
          )) as unknown as Array<{ handle: string }>
        ).map((a) => a.handle),
  );
  // The search reaches as far back as the guard, in the widest window a site's search takes.
  const since: Since =
    s.maxAgeHours <= 24 ? "past-24h" : s.maxAgeHours <= 7 * 24 ? "past-week" : "past-month";
  // Search words: his own by yield, less the rested; then the model's, from `about` and yields.
  const yields = await o.step("topic yields", () =>
    topicYields(db, { platform, minFit: s.minFit, now: o.now }),
  );
  const llm = o.llm;
  const fresh =
    need > 0 && llm && s.newTopics > 0
      ? await o.step("new topics", async () => {
          try {
            const topics = await proposeTopics(llm, {
              platform,
              about: s.about,
              n: s.newTopics,
              yields,
              known: s.topics,
              audience: s.audience,
            });
            return { topics, error: null };
          } catch (err) {
            return { topics: [], error: err instanceof Error ? err.message : String(err) };
          }
        })
      : { topics: [], error: null };
  if (fresh.error) out.errors.push(`new topics: ${fresh.error}`);
  const plan = planTopics(
    s.topics,
    yields,
    fresh.topics,
    need > 0 && llm ? s.newTopics : 0,
    s.audience,
  );
  out.topics = plan.topics;
  out.rested = plan.rested;
  type Read = { foundBy: string; key?: boolean; run: () => Promise<FeedPost[]> };
  const people: Read[] = [];
  // Instagram's accounts are Graph calls, not page loads: they get their own budget.
  const graph = platform === "instagram";
  if (s.people)
    for (const k of await o.step("key people", () =>
      keyPeople(db, platform, o.now, s.audience, graph ? IG_GRAPH_PER_PASS : PEOPLE_PER_PASS),
    ))
      people.push({
        foundBy: `person: ${k.handle}`,
        key: true,
        run: () => o.read.person(k, since),
      });
  // Key people always get their reads; the pages he follows come next, ranked like key people,
  // and searches share the rest. On Instagram the searches' budget is their own.
  const pages: Read[] = s.pages.map((c) => ({
    foundBy: `${platform !== "linkedin" ? "account" : c.startsWith("in/") ? "person" : "company"}: ${c}`,
    key: true,
    run: () => o.read.page(c),
  }));
  // The home feed leads: one load, many people the account follows. It takes a search's place.
  // No `key`: LinkedIn's feed also shows strangers' posts a connection liked, so fit decides.
  const feed: Read[] = s.people ? [{ foundBy: "feed", run: () => o.read.feed() }] : [];
  const searches: Read[] = plan.topics.map((t) => ({
    foundBy: `topic: ${t}`,
    run: () => o.read.search(t, since),
  }));
  const reads: Read[] = graph
    ? [
        ...[...pages, ...people].slice(0, IG_GRAPH_PER_PASS),
        ...[...feed, ...searches].slice(0, READS_PER_PASS.instagram + feed.length),
      ]
    : [
        ...[...feed, ...pages, ...searches].slice(
          0,
          Math.max(feed.length, READS_PER_PASS[platform] - people.length),
        ),
        ...people,
      ];
  // With today's comments already waiting, nothing is read.
  for (const r of need > 0 ? reads : []) {
    if (out.capped) break;
    try {
      const posts = await r.run();
      out.reads++;
      const kept = await o.step(`keep ${r.foundBy}`, () =>
        keepPosts(db, posts, {
          platform,
          foundBy: r.foundBy,
          account: s.account,
          topics: plan.topics,
          audience: s.audience,
          key: r.key ?? false,
          ours,
          halfLifeHours: s.halfLifeHours,
          maxAgeHours: s.maxAgeHours,
          now: o.now,
        }),
      );
      out.kept += kept.found.length;
      out.dropped += kept.dropped;
    } catch (err) {
      // A used daily cap ends the pass's reads, no error: the next day's pass is past its reset.
      if (o.capped?.(err)) out.capped = true;
      else out.errors.push(`${r.foundBy}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!llm || need <= 0) return out;
  const guide = o.guide ? await o.step("guide", () => o.guide?.() ?? Promise.resolve("")) : "";
  const facts = o.facts ? await o.step("facts", async () => [...((await o.facts?.()) ?? [])]) : [];
  const posts = o.ours
    ? await o.step("our posts", async () => [...((await o.ours?.()) ?? [])])
    : [];
  const ids = await o.step("to draft", () =>
    postsToDraft(db, need, {
      platform,
      halfLifeHours: s.halfLifeHours,
      maxAgeHours: s.maxAgeHours,
      minFit: s.minFit,
      now: o.now,
    }),
  );
  for (const id of ids)
    try {
      const r = await o.step(`draft post ${id}`, () =>
        draftPost(db, llm, id, {
          guide,
          facts,
          ours: posts,
          ...(o.voice ? { voice: o.voice } : {}),
          now: o.now,
        }),
      );
      if (r === "queued") out.queued++;
    } catch (err) {
      out.errors.push(`draft ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  return out;
}
