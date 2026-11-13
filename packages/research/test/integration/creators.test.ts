/**
 * The creator index on a real Postgres: track once, a read keeps posts and counts per day, the
 * rescore finds the outlier, the feed filters it, failed reads leave the due list.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type CreatorRead,
  dueCreators,
  feedPosts,
  keepCreatorRead,
  listCreators,
  MAX_READ_FAILS,
  markReadFailed,
  trackCreator,
  untrackCreator,
} from "../../src/creators.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [
    "post_count_days",
    "follower_count_days",
    "creator_posts",
    "tracked_creators",
    "social_handles",
    "platform_objects",
  ]),
);
const db = () => pg.db;

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

/** six videos: five at 100 views, one at 1,000 */
const read = (views: number[], followers = 12_000): CreatorRead => ({
  creator: {
    platform: "youtube",
    handle: "maker",
    id: "UCmaker",
    name: "Maker",
    url: "https://www.youtube.com/@maker",
    followers,
  },
  posts: views.map((v, i) => ({
    platform: "youtube",
    id: `vid${i}`.padEnd(11, "a"),
    url: `https://www.youtube.com/watch?v=${`vid${i}`.padEnd(11, "a")}`,
    kind: "video" as const,
    date: daysAgo(i + 1),
    title: `video ${i}`,
    metrics: { views: v, likes: 10 },
  })),
});

describe("creators", () => {
  it("tracks once and merges niches", async () => {
    const a = await trackCreator(db(), {
      platform: "youtube",
      handle: "https://www.youtube.com/@maker",
      niches: ["editing"],
      addedBy: "william",
    });
    const b = await trackCreator(db(), {
      platform: "youtube",
      handle: "@maker",
      niches: ["ai", "editing"],
      addedBy: "william",
    });
    expect(a.added).toBe(true);
    expect(b.added).toBe(false);
    expect(b.id).toBe(a.id);
    expect(b.niches).toEqual(["ai", "editing"]);
  });

  it("keeps a read, scores the outlier and feeds it", async () => {
    const c = await trackCreator(db(), {
      platform: "youtube",
      handle: "@maker",
      niches: ["editing"],
      addedBy: "william",
    });
    const out = await keepCreatorRead(
      db(),
      c.id,
      read([1000, 100, 100, 100, 100, 100]),
      "2026-11-12",
    );
    expect(out).toEqual({ posts: 6, added: 6, scored: 6 });

    const [line] = await listCreators(db());
    expect(line).toMatchObject({ followers: 12_000, posts: 6, name: "Maker" });

    const feed = await feedPosts(db(), { niche: "editing", min: 5 });
    expect(feed.map((p) => [p.title, p.multiple, p.scoreCount])).toEqual([
      ["video 0", 10, "views"],
    ]);
    expect(await feedPosts(db(), { minFollowers: 50_000 })).toEqual([]);
    expect(await feedPosts(db(), { niche: "ai" })).toEqual([]);

    // the next day: counts move, rows stay one per post, the day table grows
    const next = await keepCreatorRead(
      db(),
      c.id,
      read([1000, 100, 100, 100, 100, 500]),
      "2026-11-13",
    );
    expect(next.added).toBe(0);
    const [{ n }] = [
      ...(await db().execute<{ n: number }>("select count(*)::int as n from post_count_days")),
    ] as [{ n: number }];
    expect(n).toBe(12);
    const top = await feedPosts(db(), {});
    expect(top[0]?.multiple).toBe(10);
  });

  it("keeps every kind; a retweet is never scored; a reel with no views scores on likes", async () => {
    const x = await trackCreator(db(), {
      platform: "x",
      handle: "@writer",
      niches: ["ml"],
      addedBy: "william",
    });
    const tweet = (i: number, kind: string, likes: number) => ({
      platform: "x",
      id: `${1000 + i}`,
      url: `https://x.com/writer/status/${1000 + i}`,
      kind,
      date: daysAgo(i + 1),
      text: `tweet ${i}`,
      metrics: { likes },
    });
    const xOut = await keepCreatorRead(
      db(),
      x.id,
      {
        creator: { platform: "x", handle: "writer", url: "https://x.com/writer" },
        posts: [
          tweet(0, "quote", 100),
          ...[1, 2, 3, 4, 5].map((i) => tweet(i, "quote", 10)),
          tweet(6, "retweet", 5000),
          tweet(7, "reply", 3),
        ],
      },
      "2026-11-13",
    );
    expect(xOut.posts).toBe(8);

    const ig = await trackCreator(db(), {
      platform: "instagram",
      handle: "@cutter",
      niches: ["ml"],
      addedBy: "william",
    });
    const reel = (i: number, likes: number) => ({
      platform: "instagram",
      id: `Reel${i}`,
      url: `https://www.instagram.com/reel/Reel${i}/`,
      kind: "reel",
      date: daysAgo(i + 1),
      metrics: { likes, comments: 1 },
    });
    await keepCreatorRead(
      db(),
      ig.id,
      {
        creator: {
          platform: "instagram",
          handle: "cutter",
          url: "https://www.instagram.com/cutter/",
        },
        posts: [reel(0, 80), ...[1, 2, 3, 4, 5].map((i) => reel(i, 10))],
      },
      "2026-11-13",
    );

    const kinds = [
      ...(await db().execute<{ kind: string; multiple: number | null }>(
        "select kind, multiple from creator_posts where platform = 'x' order by ref",
      )),
    ];
    expect(kinds.find((k) => k.kind === "retweet")?.multiple).toBeNull();
    expect(kinds.map((k) => k.kind).sort()).toEqual([
      "quote",
      "quote",
      "quote",
      "quote",
      "quote",
      "quote",
      "reply",
      "retweet",
    ]);
    const feed = await feedPosts(db(), { niche: "ml", min: 5 });
    expect(feed.map((p) => [p.platform, p.kind, p.multiple, p.scoreCount, p.band])).toEqual([
      ["x", "quote", 10, "likes", "10-50x"],
      ["instagram", "reel", 8, "likes", "5-10x"],
    ]);
  });

  it("scores an X post on views and keeps its likes score beside it", async () => {
    const x = await trackCreator(db(), {
      platform: "x",
      handle: "@viewer",
      niches: ["views"],
      addedBy: "william",
    });
    const tweet = (i: number, views: number, likes: number) => ({
      platform: "x",
      id: `${2000 + i}`,
      url: `https://x.com/viewer/status/${2000 + i}`,
      kind: "tweet",
      date: daysAgo(i + 1),
      text: `post ${i}`,
      metrics: { views, likes },
    });
    await keepCreatorRead(
      db(),
      x.id,
      {
        creator: { platform: "x", handle: "viewer", url: "https://x.com/viewer" },
        posts: [
          tweet(0, 6000, 20),
          tweet(1, 1000, 60),
          ...[2, 3, 4, 5, 6].map((i) => tweet(i, 1000, 10)),
        ],
      },
      "2026-11-13",
    );
    const byViews = await feedPosts(db(), { niche: "views", min: 2 });
    expect(byViews.map((p) => [p.text, p.scoreCount, p.multiple, p.likesMultiple])).toEqual([
      ["post 0", "views", 6, 2],
    ]);
    const byLikes = await feedPosts(db(), { niche: "views", min: 2, on: "likes" });
    expect(byLikes.map((p) => [p.text, p.likesMultiple, p.likesBand, p.multiple])).toEqual([
      ["post 1", 6, "5-10x", 1],
      ["post 0", 2, "1-3x", 6],
    ]);
  });

  it("leaves the due list after a read, after 3 fails, and after remove", async () => {
    const c = await trackCreator(db(), {
      platform: "youtube",
      handle: "@maker",
      niches: [],
      addedBy: "william",
    });
    expect((await dueCreators(db(), 10)).map((d) => d.id)).toEqual([c.id]);
    await keepCreatorRead(db(), c.id, read([]), "2026-11-12");
    expect(await dueCreators(db(), 10)).toEqual([]);

    await db().execute("update tracked_creators set read_at = null");
    for (let i = 0; i < MAX_READ_FAILS; i++) await markReadFailed(db(), c.id, "cap");
    await db().execute("update tracked_creators set read_at = null");
    expect(await dueCreators(db(), 10)).toEqual([]);

    // tracking again clears the fails; removing takes it off
    await trackCreator(db(), { platform: "youtube", handle: "@maker", niches: [], addedBy: "w" });
    expect(await dueCreators(db(), 10)).toHaveLength(1);
    expect(await untrackCreator(db(), c.id)).toBe(true);
    expect(await dueCreators(db(), 10)).toEqual([]);
    expect(await listCreators(db(), { all: true })).toHaveLength(1);
  });
});
