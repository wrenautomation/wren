/**
 * X as a `ContentChannel`, over autobrowse's `x` site in API v2's shape.
 * Publish = an optional media upload (a local file the worker reads) then
 * `POST /2/tweets`; list = the account's own posts; metrics = the post's
 * `public_metrics`; comments = replies found by search (a paid tier on X's
 * side; an empty page when the tier refuses); reply = a post in reply.
 * A thread (kind `thread`) posts its first post with the fields, then each next one in reply to
 * the last; a break partway stays posted and says so in `notes`, since a retry would post twice.
 * Audience = `users/me` followers. A video post's insights also ask for its media's plays and
 * playback quartiles, which sends that one read to X's API (designs/2026-10-07-content-analytics.md).
 */
import {
  type Audience,
  type CommentRow,
  type ContentChannel,
  type FetchedWith,
  type InsightGap,
  type Insights,
  type InsightsQuery,
  type InsightValue,
  knownGaps,
  type ListQuery,
  METRICS as M,
  type MediaHost,
  type Metrics,
  mediaFileOf,
  numberOf,
  type Post,
  type Published,
  type PublishedRow,
  pageOf,
  previewOf,
  readGroup,
  SiteCallError,
  type SiteClient,
} from "@wren/core/content";
import { fieldsOf, ShapeError } from "@wren/core/content/shapes";
import { threadPosts, threadUnfit } from "@wren/core/content/thread";

export interface XContentOptions {
  now?: () => Date;
  /** Makes a laptop file or a stored object reachable from the box; absent = paths are the box's own. */
  host?: MediaHost;
}

interface Tweet {
  id: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    impression_count?: number;
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
    bookmark_count?: number;
  };
  /** The author's own numbers: the API leg's user token only. */
  non_public_metrics?: {
    impression_count?: number;
    url_link_clicks?: number;
    user_profile_clicks?: number;
  };
}
interface Me {
  data?: { id?: string; username?: string; public_metrics?: { followers_count?: number } };
}
/** A post's media as `expansions=attachments.media_keys` returns it; the counts are the author's. */
interface XMedia {
  media_key?: string;
  type?: string;
  public_metrics?: { view_count?: number };
  non_public_metrics?: Partial<Record<Playback, number>>;
  organic_metrics?: Partial<Record<Playback, number>> & { view_count?: number };
}
type Playback =
  | "playback_0_count"
  | "playback_25_count"
  | "playback_50_count"
  | "playback_75_count"
  | "playback_100_count";
const QUARTILES = ["0", "25", "50", "75", "100"] as const;
/** Asking for these sends the read to X's API (the browser leg has no plays): video posts only. */
const VIDEO_QUERY = {
  expansions: "attachments.media_keys",
  "media.fields": "type,duration_ms,public_metrics,non_public_metrics,organic_metrics",
};

/** A video's plays and how far they got, from the first video on the post. */
export function videoWatch(media: readonly XMedia[] | undefined): InsightValue[] | null {
  const v = media?.find((m) => m.type === "video" || m.type === "animated_gif");
  if (!v) return null;
  const own = v.organic_metrics ?? v.non_public_metrics;
  const views = v.organic_metrics?.view_count ?? v.public_metrics?.view_count;
  const out = [
    ...numberOf(M.videoViews, views),
    ...QUARTILES.flatMap((q) => numberOf(M.playback, own?.[`playback_${q}_count`], q)),
  ];
  return out.length ? out : null;
}

export function xContent(sites: SiteClient, o: XContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("x", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  let me: Promise<{ id: string; username: string }> | null = null;
  const whoami = () => {
    me ??= sites.call<Me>("x", "GET", "/2/users/me", {}).then((r) => {
      if (!r.data?.id || !r.data.username) throw new Error("x: the token's account has no user");
      return { id: r.data.id, username: r.data.username };
    });
    return me;
  };
  const urlOf = (username: string, id: string) => `https://x.com/${username}/status/${id}`;
  return {
    platform: "x",
    async publish(post: Post): Promise<Published> {
      const body: Record<string, unknown> = { text: post.text };
      if (post.media) {
        const up = await sites.call<{ data?: { id?: string } }>("x", "POST", "/2/media/upload", {
          file: await mediaFileOf(post.media.source, o.host, "x"),
        });
        if (!up.data?.id) throw new Error("x: the media upload answered no id");
        body.media = { media_ids: [up.data.id] };
      }
      const f = fieldsOf("x", post.extra);
      const posts = f.kind === "thread" ? threadPosts(post.text) : [post.text];
      if (f.kind === "thread") {
        // The link is in the text by now: check the count as it goes out.
        const unfit = threadUnfit(posts);
        if (unfit) throw new ShapeError(`x: ${unfit}`);
        body.text = posts[0];
      }
      if (f.replyTo) body.reply = { in_reply_to_tweet_id: f.replyTo };
      if (f.quote) body.quote_tweet_id = f.quote;
      if (f.replySettings) body.reply_settings = f.replySettings;
      const tweet = async (b: Record<string, unknown>) => {
        const r = await sites.call<{ data?: { id?: string } }>("x", "POST", "/2/tweets", b);
        if (!r.data?.id) throw new Error("x: the post answered no id");
        return r.data.id;
      };
      const first = await tweet(body);
      const notes: string[] = [];
      let last = first;
      for (const [i, text] of posts.slice(1).entries()) {
        try {
          last = await tweet({ text, reply: { in_reply_to_tweet_id: last } });
        } catch (err) {
          notes.push(
            `Posted ${i + 1} of ${posts.length}: post ${i + 2} failed (${err instanceof Error ? err.message : String(err)}). Reply the rest by hand.`,
          );
          break;
        }
      }
      const { username } = await whoami();
      return {
        id: first,
        url: urlOf(username, first),
        publishedAt: now().toISOString(),
        fetchedWith: await via("POST", "/2/tweets"),
        ...(notes.length ? { notes } : {}),
      };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const { id, username } = await whoami();
      const r = await sites.call<{ data?: Tweet[] }>("x", "GET", `/2/users/${id}/tweets`, {
        max_results: Math.min(Math.max(q.limit ?? 100, 5), 100),
        exclude: "replies,retweets",
      });
      const fetchedWith = await via("GET", "/2/users/{id}/tweets");
      return pageOf(
        (r.data ?? []).map((t) => ({
          id: t.id,
          url: urlOf(username, t.id),
          publishedAt: t.created_at ?? now().toISOString(),
          fetchedWith,
          preview: previewOf(t.text ?? ""),
        })),
        q,
      );
    },
    async metrics(id: string): Promise<Metrics> {
      const r = await sites.call<{ data?: Tweet }>("x", "GET", `/2/tweets/${id}`, {});
      const m = r.data?.public_metrics;
      if (!m) throw new Error(`x: no post ${id}`);
      return {
        id,
        views: m.impression_count ?? 0,
        reactions: m.like_count ?? 0,
        comments: m.reply_count ?? 0,
        shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
        asOf: now().toISOString(),
        fetchedWith: await via("GET", "/2/tweets/{id}"),
      };
    },
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      let r: { data?: Tweet[] };
      try {
        r = await sites.call<{ data?: Tweet[] }>("x", "GET", "/2/tweets/search/recent", {
          query: `conversation_id:${id} -from:me`,
          max_results: Math.min(Math.max(q.limit ?? 100, 10), 100),
        });
      } catch (err) {
        // Search is a paid tier: without it the replies are not readable here.
        if (err instanceof SiteCallError && (err.status === 402 || err.status === 403)) return [];
        throw err;
      }
      return pageOf(
        (r.data ?? [])
          .filter((t) => t.id !== id)
          .map((t) => ({
            id: t.id,
            postId: id,
            author: t.author_id ?? "",
            text: t.text ?? "",
            at: t.created_at ?? now().toISOString(),
          })),
        q,
      );
    },
    async audience(): Promise<Audience> {
      const r = await sites.call<Me>("x", "GET", "/2/users/me", {
        "user.fields": "id,username,public_metrics",
      });
      const n = r.data?.public_metrics?.followers_count;
      if (typeof n !== "number")
        throw new Error("x: the account's follower count didn't come back");
      return { followers: n, asOf: now().toISOString(), raw: r.data };
    },
    async reply(commentId: string, text: string): Promise<void> {
      await sites.call("x", "POST", "/2/tweets", {
        text,
        reply: { in_reply_to_tweet_id: commentId },
      });
    },
    async insights(q: InsightsQuery): Promise<Insights> {
      const out: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      const video = q.media === "video";
      await readGroup(
        [
          M.views,
          M.likes,
          M.comments,
          M.shares,
          M.saves,
          M.linkClicks,
          M.profileClicks,
          ...(video ? [M.videoViews, M.playback] : []),
        ],
        async () => {
          const r = await sites.call<{ data?: Tweet; includes?: { media?: XMedia[] } }>(
            "x",
            "GET",
            `/2/tweets/${q.id}`,
            video ? VIDEO_QUERY : {},
          );
          const t = r.data;
          const p = t?.public_metrics ?? {};
          const own = t?.non_public_metrics;
          const watch = video ? videoWatch(r.includes?.media) : null;
          if (video && !watch)
            out.gaps.push(
              ...knownGaps(
                "no_api",
                "X gives a video's plays to the API leg only, for 30 days after it posts",
                [M.videoViews, M.playback],
              ),
            );
          if (!own)
            out.gaps.push(
              ...knownGaps(
                "no_api",
                "X gives link and profile clicks to the API leg only; this read went by browser",
                [M.linkClicks, M.profileClicks],
              ),
            );
          return [
            ...numberOf(M.views, p.impression_count),
            ...numberOf(M.likes, p.like_count),
            ...numberOf(M.comments, p.reply_count),
            ...numberOf(M.shares, (p.retweet_count ?? 0) + (p.quote_count ?? 0)),
            ...numberOf(M.saves, p.bookmark_count),
            ...numberOf(M.linkClicks, own?.url_link_clicks),
            ...numberOf(M.profileClicks, own?.user_profile_clicks),
            ...(watch ?? []),
          ];
        },
        out,
      );
      return { ...out, asOf: now().toISOString() };
    },
  };
}
