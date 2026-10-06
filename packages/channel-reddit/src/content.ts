/**
 * Reddit as a `ContentChannel`, over autobrowse's `reddit` site in Reddit's
 * own API shape (oauth.reddit.com). Publish = `POST /api/submit` into the
 * draft's `extra.subreddit`: a text post, or a link post when `extra.url` is
 * set. list = the account's own submissions; metrics = score and comment
 * count from `/api/info` (Reddit shows no views to the API); comments = the
 * post's top-level thread; reply = `POST /api/comment`; activity = the
 * username mentions in the inbox; audience = the profile's followers.
 */
import {
  type ActivityQuery,
  type ActivityRow,
  type Audience,
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

export const REDDIT_SITE = "reddit";

export interface RedditContentOptions {
  now?: () => Date;
}

/** A `t3` (post) or `t1` (comment) as a listing carries it; only what is read. */
export interface Thing {
  id: string;
  name: string;
  title?: string;
  selftext?: string;
  body?: string;
  author?: string;
  permalink?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
  num_crossposts?: number;
  view_count?: number | null;
}
export interface Listing {
  kind?: string;
  data?: { children?: Array<{ kind: string; data: Thing }> };
}
/** An inbox item: a `t1` mention carries `type` and the comment's `context` link. */
interface InboxThing extends Thing {
  type?: string;
  context?: string;
}
/** Post and comment replies already reach `comments`; only mentions are activity. */
const MENTION = "username_mention";

/** Reddit's `api_type=json` envelope: errors are `[code, message, field]` triples. */
interface JsonAnswer<T> {
  json?: { errors?: Array<[string, string, string?]>; data?: T };
}

export const redditUrl = (permalink: string) => `https://www.reddit.com${permalink}`;
const at = (utc: number | undefined, now: () => Date) =>
  (utc ? new Date(utc * 1000) : now()).toISOString();
/** `t3_abc` → `abc`: rows carry the bare id, calls take the fullname. */
export const bareId = (id: string) => id.replace(/^t\d_/, "");
const children = (l: Listing | undefined) => (l?.data?.children ?? []).map((c) => c.data);

/** The answer's data, or the refusal Reddit gave (a 200 carrying errors) as a 422: final, not retried. */
export function answerOf<T>(path: string, a: JsonAnswer<T>): T {
  const err = a.json?.errors?.[0];
  if (err) throw new SiteCallError(REDDIT_SITE, "POST", path, 422, `${err[0]} ${err[1]}`);
  if (!a.json?.data) throw new SiteCallError(REDDIT_SITE, "POST", path, 502, "no data");
  return a.json.data;
}

export function redditContent(sites: SiteClient, o: RedditContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const call = <T>(
    method: "GET" | "POST",
    path: string,
    input: Record<string, unknown> = {},
  ): Promise<T> => sites.call<T>(REDDIT_SITE, method, path, input);
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via(REDDIT_SITE, method, path).then((v) => (v === "browser" ? "browser" : "api"));
  let me: Promise<string> | null = null;
  const whoami = () => {
    me ??= call<{ name?: string }>("GET", "/api/v1/me").then((r) => {
      if (!r.name) throw new Error("reddit: the token's account has no name");
      return r.name;
    });
    return me;
  };
  return {
    platform: "reddit",
    async publish(post: Post): Promise<Published> {
      const sr = post.extra?.subreddit;
      const title = post.extra?.title;
      if (typeof sr !== "string" || sr === "")
        throw new Error("reddit: extra.subreddit is required");
      if (typeof title !== "string" || title === "") throw new Error("reddit: a title is required");
      if (post.media)
        throw new Error("reddit: media posts are not wired; put the link in extra.url");
      const link = typeof post.extra?.url === "string" ? post.extra.url : null;
      const data = answerOf<{ id?: string; name?: string; url?: string }>(
        "/api/submit",
        await call("POST", "/api/submit", {
          api_type: "json",
          sr: sr.replace(/^r\//, ""),
          title,
          ...(link ? { kind: "link", url: link } : { kind: "self", text: post.text }),
          ...(post.extra?.flairId ? { flair_id: post.extra.flairId } : {}),
          resubmit: true,
          sendreplies: true,
        }),
      );
      const id = data.id ?? (data.name ? bareId(data.name) : null);
      if (!id) throw new Error("reddit: the submit answered no id");
      return {
        id,
        url: data.url ?? `https://www.reddit.com/comments/${id}`,
        publishedAt: now().toISOString(),
        fetchedWith: await via("POST", "/api/submit"),
      };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const name = await whoami();
      const r = await call<Listing>("GET", `/user/${name}/submitted`, {
        limit: Math.min(Math.max(q.limit ?? 100, 1), 100),
        sort: "new",
        raw_json: 1,
      });
      const fetchedWith = await via("GET", "/user/{username}/submitted");
      return pageOf(
        children(r).map((t) => ({
          id: t.id,
          url: redditUrl(t.permalink ?? `/comments/${t.id}`),
          publishedAt: at(t.created_utc, now),
          fetchedWith,
          preview: previewOf(t.title ?? t.selftext ?? ""),
        })),
        q,
      );
    },
    async metrics(id: string): Promise<Metrics> {
      const r = await call<Listing>("GET", "/api/info", { id: `t3_${bareId(id)}`, raw_json: 1 });
      const t = children(r)[0];
      if (!t) throw new Error(`reddit: no post ${id}`);
      return {
        id,
        views: t.view_count ?? 0,
        reactions: t.score ?? 0,
        comments: t.num_comments ?? 0,
        shares: t.num_crossposts ?? 0,
        asOf: now().toISOString(),
        fetchedWith: await via("GET", "/api/info"),
      };
    },
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      const r = await call<[Listing, Listing]>("GET", `/comments/${bareId(id)}`, {
        limit: Math.min(Math.max(q.limit ?? 100, 1), 100),
        depth: 1,
        sort: "new",
        raw_json: 1,
      });
      return pageOf(
        children(r[1])
          .filter((c) => c.body !== undefined)
          .map((c) => ({
            id: c.id,
            postId: bareId(id),
            author: c.author ?? "",
            text: c.body ?? "",
            at: at(c.created_utc, now),
          })),
        q,
      );
    },
    async reply(commentId: string, text: string): Promise<void> {
      answerOf(
        "/api/comment",
        await call<{ json?: { errors?: Array<[string, string, string?]>; data?: unknown } }>(
          "POST",
          "/api/comment",
          {
            api_type: "json",
            thing_id: `t1_${bareId(commentId)}`,
            text,
          },
        ),
      );
    },
    // autobrowse's `/message/{where}` takes inbox|unread|sent, so mentions are picked from the inbox.
    async activity(q: ActivityQuery = {}): Promise<ActivityRow[]> {
      const r = await call<Listing>("GET", "/message/inbox", { limit: 100 });
      const { since } = q;
      return (children(r) as InboxThing[])
        .filter((t) => t.type === MENTION)
        .map((t) => ({
          id: t.id,
          kind: "mention" as const,
          actor: t.author ?? null,
          actorUrl: t.author ? `https://www.reddit.com/user/${t.author}/` : null,
          text: (t.body ?? "").split("\n")[0] ?? "",
          url: t.context ? redditUrl(t.context) : null,
          at: t.created_utc ? at(t.created_utc, now) : null,
          raw: t,
        }))
        .filter((a) => !since || a.at === null || a.at >= since)
        .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
        .slice(0, q.limit ?? 25);
    },
    async audience(): Promise<Audience> {
      const name = await whoami();
      // autobrowse's card: flat, with `followers` from the profile's subscriber count.
      const r = await call<{ followers?: number }>("GET", `/user/${name}/about`);
      const followers = r.followers;
      if (typeof followers !== "number")
        throw new Error(`reddit: u/${name} has no profile, so no follower count`);
      return { followers, asOf: now().toISOString(), raw: r };
    },
  };
}
