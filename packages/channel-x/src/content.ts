/**
 * X as a `ContentChannel`, over autobrowse's `x` site in API v2's shape.
 * Publish = an optional media upload (a local file the worker reads) then
 * `POST /2/tweets`; list = the account's own posts; metrics = the post's
 * `public_metrics`; comments = replies found by search (a paid tier on X's
 * side; an empty page when the tier refuses); reply = a post in reply.
 */
import {
  type CommentRow,
  type ContentChannel,
  type FetchedWith,
  type ListQuery,
  type Metrics,
  type Post,
  type Published,
  type PublishedRow,
  pageOf,
  previewOf,
  SiteCallError,
  type SiteClient,
} from "@wren/core/content";

export interface XContentOptions {
  now?: () => Date;
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
  };
}
interface Me {
  data?: { id?: string; username?: string };
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
          file: post.media.source,
        });
        if (!up.data?.id) throw new Error("x: the media upload answered no id");
        body.media = { media_ids: [up.data.id] };
      }
      if (post.extra?.replyTo) body.reply = { in_reply_to_tweet_id: post.extra.replyTo };
      if (post.extra?.quote) body.quote_tweet_id = post.extra.quote;
      const r = await sites.call<{ data?: { id?: string } }>("x", "POST", "/2/tweets", body);
      if (!r.data?.id) throw new Error("x: the post answered no id");
      const { username } = await whoami();
      return {
        id: r.data.id,
        url: urlOf(username, r.data.id),
        publishedAt: now().toISOString(),
        fetchedWith: await via("POST", "/2/tweets"),
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
    async reply(commentId: string, text: string): Promise<void> {
      await sites.call("x", "POST", "/2/tweets", {
        text,
        reply: { in_reply_to_tweet_id: commentId },
      });
    },
  };
}
