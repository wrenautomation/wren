/**
 * The creator index (designs/2026-11-12-eden-method.md §3, option A). `trackCreator` adds a
 * creator; `keepCreatorRead` stores one read of their profile and posts (counts per day, followers
 * per day) and rescores their posts with weaver's `scoreOf`; `feedPosts` is the outlier feed the
 * CLI and the portal share.
 */
import { resolveObjects } from "@wren/core/objects";
import { normalizeHandle, resolveHandle } from "@wren/core/touches";
import { socialHandles } from "@wren/core/touches-schema";
import { atomic, type Db, type Queryable } from "@wren/db";
import {
  bandOf,
  baselineKindOf,
  countOf,
  type ScoredPost,
  scoreOf,
} from "@wrenautomation/weaver/ledger";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  creatorPosts as cp,
  followerCountDays,
  postCountDays,
  type TrackedCreator,
  trackedCreators as tc,
} from "./creators-schema.js";
import type { Source } from "./sops/index.js";

export { POST_KINDS, type TrackedCreator } from "./creators-schema.js";

/** failed reads in a row before a creator waits for a person */
export const MAX_READ_FAILS = 3;
/** a creator read less than this long ago is not due */
const READ_EVERY_HOURS = 20;

export type Counts = Partial<Record<"views" | "likes" | "comments" | "shares" | "saves", number>>;

/** One read of a creator, as `weaver posts <profile> --json` answers it. */
export interface CreatorRead {
  creator: {
    platform: string;
    handle: string;
    /** the platform's own user id */
    id?: string;
    name?: string;
    url: string;
    followers?: number;
    raw?: unknown;
  };
  posts: {
    platform: string;
    /** the platform's id: video id, shortcode, tweet id, URN */
    id: string;
    url: string;
    kind: string;
    /** ISO */
    date?: string;
    title?: string;
    text?: string;
    metrics?: Counts;
    data?: unknown;
  }[];
}

// ---- The list ----------------------------------------------------------------------------------

export class HandleError extends Error {}

/** Track a creator, or widen a tracked one's niches; a retired one comes back. */
export async function trackCreator(
  db: Db,
  o: { platform: string; handle: string; niches: string[]; note?: string; addedBy: string },
): Promise<TrackedCreator & { handle: string; url: string | null; added: boolean }> {
  const ref = normalizeHandle(o.platform, o.handle);
  if (!ref || ref.handle.includes(":"))
    throw new HandleError(`not a ${o.platform} handle or profile URL: ${o.handle}`);
  return atomic(db, async (tx) => {
    const h = await resolveHandle(tx, ref);
    const [row] = await tx
      .insert(tc)
      .values({
        handleId: h.id,
        niches: [...new Set(o.niches)].sort(),
        note: o.note ?? null,
        addedBy: o.addedBy,
      })
      .onConflictDoUpdate({
        target: tc.handleId,
        set: {
          niches: sql.raw(
            `(select coalesce(array_agg(distinct x order by x), '{}') from unnest(tracked_creators.niches || excluded.niches) x)`,
          ),
          note: sql`coalesce(excluded.note, ${tc.note})`,
          active: true,
          readFails: 0,
        },
      })
      .returning({ ...tableColumns, added: sql<boolean>`xmax = 0` });
    const r = row as TrackedCreator & { added: boolean };
    return { ...r, handle: h.handle, url: h.url };
  });
}

const tableColumns = {
  id: tc.id,
  handleId: tc.handleId,
  niches: tc.niches,
  note: tc.note,
  addedBy: tc.addedBy,
  addedAt: tc.addedAt,
  active: tc.active,
  platformId: tc.platformId,
  raw: tc.raw,
  readAt: tc.readAt,
  readFails: tc.readFails,
  readError: tc.readError,
  record: tc.record,
};

/** Stop reading a creator; their rows stay. */
export async function untrackCreator(db: Queryable, id: number): Promise<boolean> {
  const out = await db
    .update(tc)
    .set({ active: false })
    .where(eq(tc.id, id))
    .returning({ id: tc.id });
  return out.length > 0;
}

export interface CreatorLine {
  id: number;
  platform: string;
  handle: string;
  url: string | null;
  name: string | null;
  niches: string[];
  note: string | null;
  addedBy: string;
  active: boolean;
  followers: number | null;
  posts: number;
  readAt: Date | null;
  readError: string | null;
  record: string | null;
}

/** Tracked creators with their newest follower count and stored posts. */
export async function listCreators(
  db: Queryable,
  o: { niche?: string; all?: boolean; ids?: number[] } = {},
): Promise<CreatorLine[]> {
  const rows = await db
    .select({
      id: tc.id,
      platform: socialHandles.platform,
      handle: socialHandles.handle,
      url: socialHandles.url,
      name: socialHandles.name,
      niches: tc.niches,
      note: tc.note,
      addedBy: tc.addedBy,
      active: tc.active,
      followers: sql<number | null>`(select f.followers from follower_count_days f
        where f.creator_id = ${tc.id} order by f.day desc limit 1)`,
      posts: sql<number>`(select count(*)::int from creator_posts p where p.creator_id = ${tc.id})`,
      readAt: tc.readAt,
      readError: tc.readError,
      record: tc.record,
    })
    .from(tc)
    .innerJoin(socialHandles, eq(socialHandles.id, tc.handleId))
    .where(
      and(
        o.all ? undefined : eq(tc.active, true),
        o.niche ? sql`${o.niche} = any(${tc.niches})` : undefined,
        o.ids ? inArray(tc.id, o.ids) : undefined,
      ),
    )
    .orderBy(asc(socialHandles.platform), asc(socialHandles.handle));
  return rows;
}

/** Creators to read now: active, under the fail limit, never read or read over 20 hours ago. */
export function dueCreators(db: Queryable, limit: number) {
  return db
    .select({
      id: tc.id,
      platform: socialHandles.platform,
      handle: socialHandles.handle,
      url: socialHandles.url,
    })
    .from(tc)
    .innerJoin(socialHandles, eq(socialHandles.id, tc.handleId))
    .where(
      and(
        eq(tc.active, true),
        lt(tc.readFails, MAX_READ_FAILS),
        or(
          isNull(tc.readAt),
          lt(tc.readAt, sql`now() - make_interval(hours => ${READ_EVERY_HOURS})`),
        ),
      ),
    )
    .orderBy(sql`${tc.readAt} asc nulls first`, asc(tc.id))
    .limit(limit);
}

export async function markReadFailed(db: Queryable, id: number, error: string) {
  await db
    .update(tc)
    .set({
      readFails: sql`${tc.readFails} + 1`,
      readError: error.slice(0, 2000),
      readAt: sql`now()`,
    })
    .where(eq(tc.id, id));
}

// ---- One read ----------------------------------------------------------------------------------

/** Store a read: the profile, today's followers, each post and its counts today; then rescore. */
export async function keepCreatorRead(
  db: Db,
  creatorId: number,
  read: CreatorRead,
  day: string,
): Promise<{ posts: number; added: number; scored: number }> {
  return atomic(db, async (tx) => {
    await tx
      .update(tc)
      .set({
        raw: (read.creator.raw ?? read.creator) as object,
        ...(read.creator.id ? { platformId: read.creator.id.slice(0, 64) } : {}),
        readAt: sql`now()`,
        readFails: 0,
        readError: null,
      })
      .where(eq(tc.id, creatorId));
    if (read.creator.name)
      await tx
        .update(socialHandles)
        .set({ name: sql`coalesce(${socialHandles.name}, ${read.creator.name})` })
        .where(
          eq(
            socialHandles.id,
            sql`(select handle_id from tracked_creators where id = ${creatorId})`,
          ),
        );
    if (typeof read.creator.followers === "number")
      await tx
        .insert(followerCountDays)
        .values({ creatorId, day, followers: Math.round(read.creator.followers) })
        .onConflictDoUpdate({
          target: [followerCountDays.creatorId, followerCountDays.day],
          set: { followers: sql`excluded.followers`, readAt: sql`now()` },
        });
    const posts = read.posts;
    if (!posts.length) return { posts: 0, added: 0, scored: await rescore(tx, creatorId) };
    const refs = await resolveObjects(
      tx,
      posts.map((p) => ({
        platform: p.platform as never,
        kind: "post" as const,
        raw: p.id,
        url: p.url,
        author: read.creator.handle,
        at: p.date ? new Date(p.date) : null,
      })),
    );
    const rows = new Map<string, typeof cp.$inferInsert>();
    const counts = new Map<string, typeof postCountDays.$inferInsert>();
    for (const p of posts) {
      const ref = refs.get(p.id) as string;
      const key = `${p.platform}:${ref}`;
      rows.set(key, {
        platform: p.platform,
        ref,
        creatorId,
        url: p.url,
        kind: p.kind,
        postedAt: p.date ? new Date(p.date) : null,
        title: p.title ?? null,
        text: p.text ?? null,
        raw: (p.data ?? p) as object,
      });
      if (p.metrics && Object.keys(p.metrics).length)
        counts.set(key, { platform: p.platform, ref, day, counts: p.metrics });
    }
    const out = await tx
      .insert(cp)
      .values([...rows.values()])
      .onConflictDoUpdate({
        target: [cp.platform, cp.ref],
        set: {
          lastSeen: sql`now()`,
          url: sql`excluded.url`,
          kind: sql`excluded.kind`,
          postedAt: sql`coalesce(excluded.posted_at, ${cp.postedAt})`,
          title: sql`coalesce(excluded.title, ${cp.title})`,
          text: sql`coalesce(excluded.text, ${cp.text})`,
          raw: sql`excluded.raw`,
        },
      })
      .returning({ fresh: sql<boolean>`xmax = 0` });
    if (counts.size)
      await tx
        .insert(postCountDays)
        .values([...counts.values()])
        .onConflictDoUpdate({
          target: [postCountDays.platform, postCountDays.ref, postCountDays.day],
          set: { counts: sql`excluded.counts`, readAt: sql`now()` },
        });
    return {
      posts: rows.size,
      added: out.filter((r) => r.fresh).length,
      scored: await rescore(tx, creatorId),
    };
  });
}

/** Score every stored post of a creator against the creator's other posts of its kind. */
async function rescore(db: Queryable, creatorId: number): Promise<number> {
  const rows = await db.execute<{
    platform: string;
    ref: string;
    kind: string;
    posted_at: string | null;
    counts: Counts | null;
  }>(sql`select p.platform, p.ref, p.kind, p.posted_at, c.counts
    from creator_posts p
    left join lateral (select d.counts from post_count_days d
      where d.platform = p.platform and d.ref = p.ref order by d.day desc limit 1) c on true
    where p.creator_id = ${creatorId}
    order by p.posted_at desc nulls last, p.first_seen desc`);
  const all = [...rows].filter((r) => r.kind !== "retweet"); // a retweet's counts are the original's
  const posts = all.map(
    (r): ScoredPost => ({
      ...(r.posted_at ? { at: new Date(r.posted_at).toISOString() } : {}),
      kind: baselineKindOf(r.platform, r.kind),
      metrics: r.counts ?? {},
    }),
  );
  let scored = 0;
  for (const [i, r] of all.entries()) {
    const self = posts[i] as ScoredPost;
    const want = countOf(r.platform, r.kind);
    // IG grid reads carry no reel views: likes until a read gives views
    const count = self.metrics[want] == null && self.metrics.likes != null ? "likes" : want;
    const s = scoreOf(self, posts, { count });
    const l = count === "likes" ? s : scoreOf(self, posts, { count: "likes" });
    await db
      .update(cp)
      .set({
        scoreCount: s.count,
        multiple: s.multiple ?? null,
        rank: s.rank ?? null,
        likesMultiple: l.multiple ?? null,
        likesRank: l.rank ?? null,
        baselineN: s.n,
        scoredAt: sql`now()`,
      })
      .where(and(eq(cp.platform, r.platform), eq(cp.ref, r.ref)));
    if (s.multiple !== undefined) scored++;
  }
  return scored;
}

// ---- The feed ----------------------------------------------------------------------------------

/** Eden's presets: each window is post age; each multiple is on the post's own count. */
export const FEED_PRESETS = {
  breakouts: { maxFollowers: 50_000, min: 5, days: 90 },
  "hidden-gems": { maxFollowers: 20_000, min: 10, days: 180 },
  "viral-now": { min: 10, days: 30, minLikes: 500 },
  "all-time-greats": { minFollowers: 50_000, min: 10 },
} as const satisfies Record<string, FeedFilter>;
export type FeedPreset = keyof typeof FEED_PRESETS;

export interface FeedFilter {
  niche?: string;
  niches?: string[];
  platforms?: string[];
  kinds?: string[];
  /** the score the min and the order use: the post's own count (default) or likes */
  on?: "count" | "likes";
  /** the least multiple */
  min?: number;
  /** posted in the last N days */
  days?: number;
  minFollowers?: number;
  maxFollowers?: number;
  minLikes?: number;
  creatorIds?: number[];
  /** every post (the feed), or scored ones only (default: the outlier list) */
  all?: boolean;
  /** newest first, or best multiple first (default) */
  sort?: "new" | "multiple";
  limit?: number;
}

export interface FeedRow {
  platform: string;
  ref: string;
  url: string;
  kind: string;
  postedAt: string | null;
  title: string | null;
  text: string | null;
  creatorId: number;
  handle: string;
  name: string | null;
  niches: string[];
  followers: number | null;
  counts: Counts;
  scoreCount: string | null;
  multiple: number | null;
  /** Eden's band of the multiple (1-3x ... 50x+); none under 1x */
  band: string | null;
  rank: number | null;
  /** the same score on likes; equals multiple when the count is likes */
  likesMultiple: number | null;
  likesBand: string | null;
  likesRank: number | null;
  baselineN: number | null;
  record: string | null;
  /** its picture in the media bucket (`cache/posts/...`), once copied */
  picture: string | null;
  /** the platform's own picture link, from the stored item; IG links expire in days */
  pictureLink: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const at = (v: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string | number, unknown>)[k] : undefined),
    v,
  );

/** A post's picture link from the item a read stored: IG's poster or photo, X's first media. */
function pictureLinkOf(platform: string, ref: string, raw: unknown): string | null {
  if (platform === "instagram")
    // a video's media_url is the mp4: its poster only
    return (
      str(at(raw, "thumbnail_url")) ??
      (at(raw, "media_type") === "VIDEO" ? null : str(at(raw, "media_url")))
    );
  if (platform === "x")
    return (
      str(at(raw, "legacy", "extended_entities", "media", 0, "media_url_https")) ??
      str(
        at(
          raw,
          "quoted_status_result",
          "result",
          "legacy",
          "extended_entities",
          "media",
          0,
          "media_url_https",
        ),
      )
    );
  if (platform === "youtube") return `https://i.ytimg.com/vi/${ref}/hqdefault.jpg`;
  return null;
}

/** The bucket key a post's picture is copied to. */
export const pictureKeyOf = (platform: string, ref: string) =>
  `cache/posts/${platform}/${ref.replace(/[^\w.-]/g, "_")}.jpg`;

/** Posts with a picture link and no copy yet, newest first: what the copy step takes. */
export async function postsToCopy(
  db: Queryable,
  o: { creatorIds?: number[]; limit?: number } = {},
): Promise<{ platform: string; ref: string; link: string }[]> {
  const rows = await db.execute<{ platform: string; ref: string; raw: unknown }>(sql`select
      p.platform, p.ref, p.raw from creator_posts p
    where p.picture is null and p.kind <> 'retweet'
      ${o.creatorIds?.length ? sql`and p.creator_id in (${list(o.creatorIds)})` : sql``}
    order by p.posted_at desc nulls last limit ${o.limit ?? 500}`);
  return [...rows].flatMap((r) => {
    const link = pictureLinkOf(r.platform, r.ref, r.raw);
    return link ? [{ platform: r.platform, ref: r.ref, link }] : [];
  });
}

/** The copy is in the bucket. */
export async function setPicture(db: Queryable, platform: string, ref: string, key: string) {
  await db
    .update(cp)
    .set({ picture: key })
    .where(and(eq(cp.platform, platform), eq(cp.ref, ref)));
}

const list = (xs: readonly (string | number)[]) =>
  sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  );

/** Outlier posts, best multiple first: the CLI and the portal both read this. */
export async function feedPosts(db: Queryable, f: FeedFilter): Promise<FeedRow[]> {
  const m = f.on === "likes" ? sql`p.likes_multiple` : sql`p.multiple`;
  // a retweet is the original's post, never the creator's
  const where = [sql`p.kind <> 'retweet'`];
  if (!f.all) where.push(sql`${m} is not null`);
  if (f.min !== undefined) where.push(sql`${m} >= ${f.min}`);
  if (f.days !== undefined)
    where.push(sql`p.posted_at >= now() - make_interval(days => ${f.days})`);
  if (f.niche) where.push(sql`${f.niche} = any(c.niches)`);
  if (f.niches?.length) where.push(sql`c.niches && array[${list(f.niches)}]::text[]`);
  if (f.platforms?.length) where.push(sql`p.platform in (${list(f.platforms)})`);
  if (f.kinds?.length) where.push(sql`p.kind in (${list(f.kinds)})`);
  if (f.creatorIds?.length) where.push(sql`p.creator_id in (${list(f.creatorIds)})`);
  if (f.minFollowers !== undefined) where.push(sql`fo.followers >= ${f.minFollowers}`);
  if (f.maxFollowers !== undefined) where.push(sql`fo.followers < ${f.maxFollowers}`);
  if (f.minLikes !== undefined) where.push(sql`(co.counts->>'likes')::bigint >= ${f.minLikes}`);
  const rows = await db.execute<{
    platform: string;
    ref: string;
    url: string;
    kind: string;
    posted_at: string | null;
    title: string | null;
    text: string | null;
    creator_id: number;
    handle: string;
    name: string | null;
    niches: string[];
    followers: number | null;
    counts: Counts | null;
    score_count: string | null;
    multiple: number | null;
    rank: number | null;
    likes_multiple: number | null;
    likes_rank: number | null;
    baseline_n: number | null;
    record: string | null;
    picture: string | null;
    raw: unknown;
  }>(sql`select p.platform, p.ref, p.url, p.kind, p.posted_at, p.title, p.text, p.creator_id,
      h.handle, h.name, c.niches, fo.followers, co.counts, p.score_count, p.multiple, p.rank,
      p.likes_multiple, p.likes_rank, p.baseline_n, p.record, p.picture,
      case when p.picture is null then p.raw end as raw
    from creator_posts p
    join tracked_creators c on c.id = p.creator_id
    join social_handles h on h.id = c.handle_id
    left join lateral (select f.followers from follower_count_days f
      where f.creator_id = c.id order by f.day desc limit 1) fo on true
    left join lateral (select d.counts from post_count_days d
      where d.platform = p.platform and d.ref = p.ref order by d.day desc limit 1) co on true
    where ${sql.join(where, sql` and `)}
    order by ${f.sort === "new" ? sql`p.posted_at desc nulls last, ${m} desc nulls last` : sql`${m} desc nulls last, p.posted_at desc nulls last`}
    limit ${f.limit ?? 50}`);
  return [...rows].map((r) => ({
    platform: r.platform,
    ref: r.ref,
    url: r.url,
    kind: r.kind,
    postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
    title: r.title,
    text: r.text,
    creatorId: r.creator_id,
    handle: r.handle,
    name: r.name,
    niches: r.niches,
    followers: r.followers,
    counts: r.counts ?? {},
    scoreCount: r.score_count,
    multiple: r.multiple,
    band: r.multiple != null ? (bandOf(r.multiple) ?? null) : null,
    rank: r.rank,
    likesMultiple: r.likes_multiple,
    likesBand: r.likes_multiple != null ? (bandOf(r.likes_multiple) ?? null) : null,
    likesRank: r.likes_rank,
    baselineN: r.baseline_n,
    record: r.record,
    picture: r.picture,
    pictureLink: r.picture ? null : pictureLinkOf(r.platform, r.ref, r.raw),
  }));
}

export interface FeedFacets {
  /** active creators */
  creators: number;
  /** posts with a multiple */
  scored: number;
  niches: { value: string; n: number }[];
  platforms: { value: string; n: number }[];
  /** kinds of their posts, with post counts */
  kinds: { value: string; n: number }[];
  /** active creators, with their post counts */
  people: { id: number; handle: string; name: string | null; platform: string; n: number }[];
}

/** What the feed's picks offer: niches and platforms of active creators, with counts. */
export async function feedFacets(db: Queryable): Promise<FeedFacets> {
  const [head] = [
    ...(await db.execute<{ creators: number; scored: number }>(sql`select
      (select count(*)::int from tracked_creators where active) as creators,
      (select count(*)::int from creator_posts where multiple is not null) as scored`)),
  ];
  const niches = await db.execute<{
    value: string;
    n: number;
  }>(sql`select x as value, count(*)::int as n
    from tracked_creators, unnest(niches) x where active group by x order by n desc, x`);
  const platforms = await db.execute<{ value: string; n: number }>(sql`select h.platform as value,
    count(*)::int as n from tracked_creators c join social_handles h on h.id = c.handle_id
    where c.active group by h.platform order by n desc, h.platform`);
  const kinds = await db.execute<{ value: string; n: number }>(sql`select p.kind as value,
    count(*)::int as n from creator_posts p join tracked_creators c on c.id = p.creator_id
    where c.active and p.kind <> 'retweet' group by p.kind order by n desc, p.kind`);
  const people = await db.execute<{
    id: number;
    handle: string;
    name: string | null;
    platform: string;
    n: number;
  }>(sql`select c.id, h.handle, h.name, h.platform,
    (select count(*)::int from creator_posts p where p.creator_id = c.id and p.kind <> 'retweet') as n
    from tracked_creators c join social_handles h on h.id = c.handle_id
    where c.active order by lower(coalesce(h.name, h.handle))`);
  return {
    creators: head?.creators ?? 0,
    scored: head?.scored ?? 0,
    niches: [...niches],
    platforms: [...platforms],
    kinds: [...kinds],
    people: [...people],
  };
}

// ---- Promotion into Canon ----------------------------------------------------------------------

export async function markCreatorPromoted(db: Queryable, id: number, record: string) {
  await db.update(tc).set({ record }).where(eq(tc.id, id));
}

export async function markPostPromoted(
  db: Queryable,
  platform: string,
  ref: string,
  record: string,
) {
  await db
    .update(cp)
    .set({ record })
    .where(and(eq(cp.platform, platform), eq(cp.ref, ref)));
}

/** A creator as a Canon `person` record: the profile, the adder's words, the top posts by multiple. */
export function creatorSource(c: CreatorLine, top: readonly FeedRow[]): Source {
  const slug = c.handle.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
  const title = c.name ? `${c.name} (@${c.handle})` : `@${c.handle}`;
  const head = [
    "---",
    `url: ${JSON.stringify(c.url ?? "")}`,
    `title: ${JSON.stringify(`${title} on ${c.platform}`)}`,
    `channel: ${JSON.stringify(c.handle)}`,
    "---",
  ];
  const lines = [
    `# ${title} on ${c.platform}`,
    "",
    ...(c.note ? [`Why tracked: ${c.note}`, ""] : []),
    ...(c.followers !== null ? [`Followers: ${c.followers}`, ""] : []),
    ...(c.niches.length ? [`Niches: ${c.niches.join(", ")}`, ""] : []),
    ...(top.length
      ? [
          "Top posts by multiple over their usual draw:",
          "",
          ...top.map(
            (p) =>
              `- ${p.multiple?.toFixed(1)}x ${p.scoreCount ?? ""}: ${p.title ?? p.text?.slice(0, 120) ?? p.kind} ${p.url}`,
          ),
        ]
      : []),
  ];
  return {
    name: `creator-${c.platform}-${slug}.md`,
    md: `${head.filter((l) => l !== 'url: ""').join("\n")}\n${lines.join("\n")}\n`,
  };
}
