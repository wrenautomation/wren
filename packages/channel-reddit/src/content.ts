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
  type InsightGap,
  type Insights,
  type InsightsQuery,
  type InsightValue,
  knownGaps,
  type ListQuery,
  METRICS as M,
  type Metrics,
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
import { redditCommentRef as commentRef } from "@wren/core/objects";
import { threadOf, threadQuery } from "./thread.js";

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
  /** The author's `t2_` id; a signed-out feed does not carry it. */
  author_fullname?: string;
  permalink?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
  num_crossposts?: number;
  view_count?: number | null;
  upvote_ratio?: number;
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
/** `t3_abc` → `abc`. Calls take either form; the writers spell a post `t3_abc` in the database. */
export const bareId = (id: string) => id.replace(/^t\d_/, "");
/**
 * A comment's one id in Wren: Reddit's `t1_` fullname, whichever reader saw it. Every reader keys
 * a comment through this, so one comment is one `comments` row. The
 * rule lives in core (`@wren/core/objects`), beside every other platform's.
 */
export { commentRef };

const children = (l: Listing | undefined) => (l?.data?.children ?? []).map((c) => c.data);

/** The answer's data, or the refusal Reddit gave (a 200 carrying errors) as a 422: final, not retried. */
export function answerOf<T>(path: string, a: JsonAnswer<T>): T {
  const err = a.json?.errors?.[0];
  if (err) throw new SiteCallError(REDDIT_SITE, "POST", path, 422, `${err[0]} ${err[1]}`);
  if (!a.json?.data) throw new SiteCallError(REDDIT_SITE, "POST", path, 502, "no data");
  return a.json.data;
}

/** `/api/info` answers up to 100 fullnames in one read. */
const INFO_FULLNAMES = 100;

export function redditContent(sites: SiteClient, o: RedditContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const call = <T>(
    method: "GET" | "POST",
    path: string,
    input: Record<string, unknown> = {},
  ): Promise<T> => sites.call<T>(REDDIT_SITE, method, path, input);
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via(REDDIT_SITE, method, path).then((v) => (v === "browser" ? "browser" : "api"));
  /** These posts by bare id, at most `INFO_FULLNAMES` to a read. */
  const things = async (ids: string[]): Promise<Map<string, Thing>> => {
    const out = new Map<string, Thing>();
    for (let i = 0; i < ids.length; i += INFO_FULLNAMES) {
      const names = ids.slice(i, i + INFO_FULLNAMES).map((id) => `t3_${bareId(id)}`);
      const r = await call<Listing>("GET", "/api/info", { id: names.join(","), raw_json: 1 });
      for (const t of children(r)) out.set(t.id, t);
    }
    return out;
  };
  const metricsOf = (id: string, t: Thing, fetchedWith: FetchedWith): Metrics => ({
    id,
    views: t.view_count ?? 0,
    reactions: t.score ?? 0,
    comments: t.num_comments ?? 0,
    shares: t.num_crossposts ?? 0,
    // The numbers `insights` shows, so it need not read the post again.
    read: {
      score: t.score,
      num_comments: t.num_comments,
      num_crossposts: t.num_crossposts,
      view_count: t.view_count,
      upvote_ratio: t.upvote_ratio,
    },
    asOf: now().toISOString(),
    fetchedWith,
  });
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
      const f = fieldsOf("reddit", post.extra);
      const sr = f.subreddit;
      const title = f.title;
      if (!sr) throw new ShapeError("reddit: a subreddit is required");
      if (!title) throw new ShapeError("reddit: a title is required");
      if (post.media)
        throw new Error("reddit: media posts are not wired; put the link in extra.url");
      const link = f.url ?? null;
      const data = answerOf<{ id?: string; name?: string; url?: string; notes?: string[] }>(
        "/api/submit",
        await call("POST", "/api/submit", {
          api_type: "json",
          sr: sr.replace(/^r\//, ""),
          title,
          ...(link ? { kind: "link", url: link } : { kind: "self", text: post.text }),
          resubmit: true,
          sendreplies: f.sendReplies ?? true,
          ...(f.flair ? { flair_text: f.flair } : {}),
          ...(f.nsfw ? { nsfw: true } : {}),
          ...(f.spoiler ? { spoiler: true } : {}),
        }),
      );
      const id = data.id ?? (data.name ? bareId(data.name) : null);
      if (!id) throw new Error("reddit: the submit answered no id");
      return {
        id,
        url: data.url ?? `https://www.reddit.com/comments/${id}`,
        publishedAt: now().toISOString(),
        fetchedWith: await via("POST", "/api/submit"),
        ...(data.notes?.length ? { notes: data.notes } : {}),
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
      const t = (await things([id])).get(bareId(id));
      if (!t) throw new Error(`reddit: no post ${id}`);
      return metricsOf(id, t, await via("GET", "/api/info"));
    },
    /** `/api/info` takes a comma list of fullnames (100 at most): the posts in one read. */
    async metricsMany(posts: { id: string }[]): Promise<Metrics[]> {
      const found = await things(posts.map((p) => p.id));
      if (!found.size) return [];
      const fetchedWith = await via("GET", "/api/info");
      return posts.flatMap((p) => {
        const t = found.get(bareId(p.id));
        return t ? [metricsOf(p.id, t, fetchedWith)] : [];
      });
    },
    async commentCounts(ids: string[]): Promise<Record<string, number>> {
      const found = await things(ids);
      const out: Record<string, number> = {};
      for (const id of ids) {
        const n = found.get(bareId(id))?.num_comments;
        if (typeof n === "number") out[id] = n;
      }
      return out;
    },
    // Every comment under the post, any depth: a reply to a reply is ours to see too.
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      const read = threadOf(
        bareId(id),
        await call<[Listing, Listing]>("GET", `/comments/${bareId(id)}`, threadQuery()),
        now,
      );
      // Our post, so its author is us: our answers in the thread come back marked as ours.
      const self = read.post.handle?.toLowerCase() ?? null;
      return pageOf(
        read.nodes
          .filter((n) => n.handle !== "[deleted]")
          .reverse()
          // Comment ids keep Reddit's `t1_` fullname: the reach inbox spells them so, and one
          // comment seen by both readers must land on one row (`uq_comments_platform_ref`).
          .map((n) => ({
            id: commentRef(n.ref),
            postId: bareId(id),
            author: n.handle,
            text: n.text,
            at: n.at,
            url: n.url,
            ...(n.parent.startsWith("t1_") ? { parentId: commentRef(n.parent) } : {}),
            ...(self && n.handle.toLowerCase() === self ? { mine: true } : {}),
          })),
        { ...q, limit: Math.min(Math.max(q.limit ?? 500, 1), 500) },
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
    async insights(q: InsightsQuery): Promise<Insights> {
      const out: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      await readGroup(
        [M.likes, M.comments, M.shares, M.upvoteRatio],
        async () => {
          // The look's counts read already answered this: no second read.
          const t: Partial<Thing> | undefined =
            q.read && typeof q.read === "object"
              ? (q.read as Partial<Thing>)
              : children(
                  await call<Listing>("GET", "/api/info", {
                    id: `t3_${bareId(q.id)}`,
                    raw_json: 1,
                  }),
                )[0];
          if (!t) return [];
          if (typeof t.view_count !== "number")
            out.gaps.push(
              ...knownGaps("no_api", "Reddit shows a post's views to its author only", [M.views]),
            );
          return [
            ...numberOf(M.views, t.view_count),
            ...numberOf(M.likes, t.score),
            ...numberOf(M.comments, t.num_comments),
            ...numberOf(M.shares, t.num_crossposts),
            ...numberOf(M.upvoteRatio, t.upvote_ratio),
          ];
        },
        out,
      );
      return { ...out, asOf: now().toISOString() };
    },
  };
}
