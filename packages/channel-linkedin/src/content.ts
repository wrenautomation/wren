/**
 * LinkedIn as a `ContentChannel`, over autobrowse's site API in LinkedIn's
 * own shape (Posts API, Social Actions). Whether a call is answered by the
 * API or a browser flow is the worker's business; rows say which.
 * Activity reads the notifications page (a browser read, capped per day). Audience reads Wren's
 * own profile and Page (4 a day), on demand only: SocialWatch never asks for it. Insights read a
 * post's analytics page as Wren's account on a few days after it went up.
 */
import {
  type ActivityKind,
  type ActivityQuery,
  type ActivityRow,
  type Audience,
  type CommentRow,
  type ContentChannel,
  type FetchedWith,
  gapStateOf,
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
  SiteCallError,
  type SiteClient,
} from "@wren/core/content";
import { fieldsOf } from "@wren/core/content/shapes";

/** Our audience is Wren's account, never William's (`linkedin`) or the research alt. */
export const AUDIENCE_ACCOUNT = "linkedin@wren";

/** Days after a post went up when its analytics page is read: 5 reads a post, light on the account. */
export const ANALYTICS_DAYS: readonly number[] = [1, 3, 7, 14, 28];
const DAY_MS = 86_400_000;

/** Whether today is one of a post's analytics days (whole days since it went up). */
export function analyticsDue(published: string | null | undefined, now: Date): boolean {
  if (!published) return false;
  const at = Date.parse(published);
  if (Number.isNaN(at)) return false;
  return ANALYTICS_DAYS.includes(Math.floor((now.getTime() - at) / DAY_MS));
}

/** autobrowse `GET /analytics/post-summary/{urn}`: the page's counts, null where it showed none. */
export interface PostAnalytics {
  urn: string;
  url?: string;
  impressions: number | null;
  reached: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  sends: number | null;
  profileViewers: number | null;
  followersGained: number | null;
}

/** The names the analytics page answers in. */
const ANALYTICS_METRICS = [
  M.impressions,
  M.reach,
  M.likes,
  M.comments,
  M.shares,
  M.saves,
  M.sends,
  M.profileVisits,
  M.follows,
];

export const analyticsValues = (a: PostAnalytics): InsightValue[] => [
  ...numberOf(M.impressions, a.impressions),
  ...numberOf(M.reach, a.reached),
  ...numberOf(M.likes, a.reactions),
  ...numberOf(M.comments, a.comments),
  ...numberOf(M.shares, a.reposts),
  ...numberOf(M.saves, a.saves),
  ...numberOf(M.sends, a.sends),
  ...numberOf(M.profileVisits, a.profileViewers),
  ...numberOf(M.follows, a.followersGained),
];

export interface LinkedInContentOptions {
  /** The member's URN (`urn:li:person:…`); resolved from `/v2/userinfo` when absent. */
  author?: string;
  now?: () => Date;
}

const postUrl = (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`;

interface LiPost {
  id: string;
  commentary?: string;
  publishedAt?: number;
  createdAt?: number;
}
interface LiSocial {
  likesSummary?: { totalLikes?: number };
  commentsSummary?: { totalFirstLevelComments?: number };
}
interface LiComment {
  id?: string;
  actor?: string;
  message?: { text?: string };
  created?: { time?: number };
  object?: string;
}

/** autobrowse `GET /notifications`: newest first, `at` from the age label. */
interface LiNotification {
  id: string;
  kind: "follow" | "reaction" | "comment" | "mention" | "connection" | "view" | "other";
  actor?: string;
  actorUrl?: string;
  text: string;
  url?: string;
  at?: string;
}
/** `view` and `other` are LinkedIn's suggestions and news: dropped. */
const ACTIVITY_OF: Partial<Record<LiNotification["kind"], ActivityKind>> = {
  follow: "follow",
  reaction: "reaction",
  mention: "mention",
  comment: "notification",
  connection: "notification",
};

export function linkedinContent(sites: SiteClient, o: LinkedInContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  let author: Promise<string> | null = o.author ? Promise.resolve(o.author) : null;
  const me = () => {
    author ??= sites
      .call<{ sub: string }>("linkedin", "GET", "/v2/userinfo")
      .then((u) => `urn:li:person:${u.sub}`);
    return author;
  };
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("linkedin", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const iso = (ms: number | undefined) => new Date(ms ?? now().getTime()).toISOString();
  return {
    platform: "linkedin",
    async publish(post: Post): Promise<Published> {
      const f = fieldsOf("linkedin", post.extra);
      const body: Record<string, unknown> = {
        author: await me(),
        commentary: post.text,
        visibility: f.visibility ?? "PUBLIC",
        lifecycleState: "PUBLISHED",
        ...(f.noReshare ? { isReshareDisabledByAuthor: true } : {}),
      };
      if (post.media) {
        // The image/video URN comes from the worker's upload routes; a source path is not a URN.
        if (!post.media.source.startsWith("urn:li:"))
          throw new Error("linkedin: media.source must be an uploaded urn:li:image|video URN");
        body.content = {
          media: {
            id: post.media.source,
            ...(post.media.title ? { title: post.media.title } : {}),
          },
        };
      }
      const { id } = await sites.call<{ id: string }>("linkedin", "POST", "/rest/posts", body);
      return {
        id,
        url: postUrl(id),
        publishedAt: now().toISOString(),
        fetchedWith: await via("POST", "/rest/posts"),
      };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const out = await sites.call<{ elements?: LiPost[] }>("linkedin", "GET", "/rest/posts", {
        q: "author",
        author: await me(),
        count: Math.min(q.limit ?? 100, 100),
      });
      const fetchedWith = await via("GET", "/rest/posts");
      const rows = (out.elements ?? []).map((p) => ({
        id: p.id,
        url: postUrl(p.id),
        publishedAt: iso(p.publishedAt ?? p.createdAt),
        fetchedWith,
        preview: previewOf(p.commentary ?? ""),
      }));
      return pageOf(rows, q);
    },
    async metrics(id: string): Promise<Metrics> {
      const path = `/rest/socialActions/${encodeURIComponent(id)}`;
      const s = await sites.call<LiSocial>("linkedin", "GET", path);
      return {
        id,
        views: 0, // impressions need the analytics surface; not on Social Actions
        reactions: s.likesSummary?.totalLikes ?? 0,
        comments: s.commentsSummary?.totalFirstLevelComments ?? 0,
        shares: 0,
        asOf: now().toISOString(),
        fetchedWith: await via("GET", "/rest/socialActions/{urn}"),
      };
    },
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      const out = await sites.call<{ elements?: LiComment[] }>(
        "linkedin",
        "GET",
        `/rest/socialActions/${encodeURIComponent(id)}/comments`,
        { count: Math.min(q.limit ?? 100, 100) },
      );
      const rows = (out.elements ?? []).map((c, i) => ({
        id: c.id ?? String(i),
        postId: id,
        author: c.actor ?? "",
        text: c.message?.text ?? "",
        at: iso(c.created?.time),
      }));
      return pageOf(rows, q);
    },
    async reply(commentId: string, text: string): Promise<void> {
      await sites.call(
        "linkedin",
        "POST",
        `/rest/socialActions/${encodeURIComponent(commentId)}/comments`,
        {
          actor: await me(),
          message: { text },
        },
      );
    },
    async audience(): Promise<Audience> {
      const out = await sites.call<{ followers: number }>(
        "linkedin",
        "GET",
        "/audience",
        {},
        AUDIENCE_ACCOUNT,
      );
      return { followers: out.followers, asOf: now().toISOString(), raw: out };
    },
    async activity(q: ActivityQuery = {}): Promise<ActivityRow[]> {
      let out: { notifications?: LiNotification[] };
      try {
        out = await sites.call("linkedin", "GET", "/notifications", { max: q.limit ?? 40 });
      } catch (err) {
        // Over the day's cap: nothing read this pass, not a failure.
        if (err instanceof SiteCallError && err.status === 429) return [];
        throw err;
      }
      const { since } = q;
      return (out.notifications ?? []).flatMap((n) => {
        const kind = ACTIVITY_OF[n.kind];
        const at = n.at ?? null;
        if (!kind || (since && at !== null && at < since)) return [];
        return [
          {
            id: n.id,
            kind,
            actor: n.actor ?? null,
            actorUrl: n.actorUrl ?? null,
            text: n.text,
            url: n.url ?? null,
            at,
            raw: n,
          },
        ];
      });
    },
    /**
     * The post's analytics page in the browser, as Wren's account, while the Community Management
     * API (`r_member_postAnalytics`) waits on review. Light: only on the days in
     * `ANALYTICS_DAYS` after it went up, and a day over the box's cap reads nothing. A day with
     * no read writes nothing, so the last read's numbers and state stand.
     */
    async insights(q: InsightsQuery): Promise<Insights> {
      const asOf = now().toISOString();
      if (!analyticsDue(q.published, now())) return { values: [], gaps: [], asOf };
      const into: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      try {
        const a = await sites.call<PostAnalytics>(
          "linkedin",
          "GET",
          `/analytics/post-summary/${encodeURIComponent(q.id)}`,
          {},
          AUDIENCE_ACCOUNT,
        );
        into.values.push(...analyticsValues(a));
        if (!into.values.length)
          into.gaps.push(
            ...knownGaps("error", "The post's analytics page showed no numbers", ANALYTICS_METRICS),
          );
      } catch (err) {
        // Over the day's cap: nothing read today, not a failure.
        if (err instanceof SiteCallError && err.status === 429)
          return { values: [], gaps: [], asOf };
        // A browser read that broke: said where the number sits, never retried as a storm.
        const why = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        into.gaps.push(...knownGaps(gapStateOf(err) ?? "error", why, ANALYTICS_METRICS));
      }
      return { ...into, asOf };
    },
  };
}
