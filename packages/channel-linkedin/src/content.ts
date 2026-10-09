/**
 * LinkedIn as a `ContentChannel`, over autobrowse's site API in LinkedIn's
 * own shape (Posts API, Social Actions). Whether a call is answered by the
 * API or a browser flow is the worker's business; rows say which.
 * Activity reads the notifications page (a browser read, capped per day). Audience reads Wren's
 * own profile and Page (4 a day), on demand only: SocialWatch never asks for it. Insights read a
 * post's analytics page as Wren's account on a few days after it went up; account insights read
 * its dashboard (profile visits, search appearances) once a day, under the same cap.
 *
 * Over a client's connected account (`direct`) there is no browser: no notifications, no audience
 * page, no analytics page. A company page (`organization`) posts, reads its comments and answers
 * them as the page, on the Community Management API, and reads its follower count there.
 */
import {
  type AccountInsights,
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
  type MediaHost,
  type Metrics,
  mediaFileOf,
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
import { carouselFiles, cleanSlides, isCarousel } from "@wren/core/content/slides";

/** Our audience is Wren's account, never William's (`linkedin`) or the research alt. */
export const AUDIENCE_ACCOUNT = "linkedin@wren";

/** The box's read of Wren's dashboard (`GET /analytics/dashboard`): counts, null when not shown. */
interface Dashboard {
  profileViewers: number | null;
  searchAppearances: number | null;
  postImpressions: number | null;
  followers: number | null;
  /** The page's window per count: profile viewers 90 days, search appearances the week before. */
  windows: Record<string, string | null>;
  url: string;
}

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
  /** A company page (`urn:li:organization:…`) it posts and answers as. Implies `direct`. */
  organization?: string;
  /** The official API only (a client's connected account): no autobrowse-only reads. */
  direct?: boolean;
  /** Makes a stored file (`s3://…`) a URL the upload fetches: images and a carousel's PDF. */
  host?: MediaHost;
  now?: () => Date;
}

/**
 * The site path that uploads one file: LinkedIn's `initializeUpload` for an image or a document,
 * then the bytes PUT to its `uploadUrl` with the same token; a video goes up in LinkedIn's parts
 * and answers once processed. Answers the URN a post names. Both
 * autobrowse (Wren's login) and a client's connected account (`socialSites`) serve it.
 */
export const UPLOAD_PATH = "/upload";
export type UploadInput = {
  kind: "image" | "document" | "video";
  /** The member or organization the file belongs to: the post's author. */
  owner: string;
  /** An https URL the server fetches the bytes from (a signed media URL). */
  file: string;
};

const VIDEO_FILE = /\.(mp4|mov|m4v|webm)$/;

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
  /** `urn:li:comment:(<post>,<id>)`: what an answer names. */
  commentUrn?: string;
  $URN?: string;
  parentComment?: string;
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

/** A comment's URN: `urn:li:comment:(<post URN>,<id>)`. */
const COMMENT_URN = /^urn:li:comment:\((.+),[^,]+\)$/;

export function linkedinContent(sites: SiteClient, o: LinkedInContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const org = o.organization ?? null;
  const direct = !!org || !!o.direct;
  const fixed = org ?? o.author;
  let author: Promise<string> | null = fixed ? Promise.resolve(fixed) : null;
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
      const upload = async (kind: UploadInput["kind"], source: string) => {
        if (source.startsWith("urn:li:")) return source;
        const file = await mediaFileOf(source, o.host, "linkedin");
        if (!/^https:\/\//.test(file))
          throw new Error("linkedin: a file needs a media host to upload (an https URL)");
        const input: UploadInput = { kind, owner: String(body.author), file };
        const { urn } = await sites.call<{ urn: string }>("linkedin", "POST", UPLOAD_PATH, input);
        return urn;
      };
      if (isCarousel({ platform: "linkedin", extra: post.extra ?? null })) {
        // A document post: the slides' PDF, titled by the first slide (LinkedIn needs a title).
        const { pdf } = carouselFiles({ extra: post.extra ?? null });
        if (!pdf) throw new Error("linkedin: the carousel has no PDF drawn");
        const first = cleanSlides(post.extra?.slides)[0]?.title;
        body.content = {
          media: {
            id: await upload("document", pdf),
            title: post.media?.title ?? first ?? "Slides",
          },
        };
      } else if (f.attachment) {
        // A file on the post's own field: a PDF goes up as a document, titled by the text's first
        // line; a video by its own upload.
        const name = f.attachment.toLowerCase().split("?")[0] ?? "";
        const pdf = name.endsWith(".pdf");
        const kind = pdf ? "document" : VIDEO_FILE.test(name) ? "video" : "image";
        const id = await upload(kind, f.attachment);
        const head = post.text.split("\n")[0]?.trim().slice(0, 100);
        body.content = {
          media:
            kind === "document"
              ? { id, title: head || "Document" }
              : kind === "video" && head
                ? { id, title: head }
                : { id },
        };
      } else if (post.media) {
        body.content = {
          media: {
            id: await upload(post.media.kind === "video" ? "video" : "image", post.media.source),
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
      // A page's comments go by URN, which an answer needs, and say which are the page's own.
      const rows = (out.elements ?? []).map((c, i) => ({
        id: (org ? (c.commentUrn ?? c.$URN) : null) ?? c.id ?? String(i),
        postId: id,
        author: c.actor ?? "",
        text: c.message?.text ?? "",
        at: iso(c.created?.time),
        ...(org && c.parentComment ? { parentId: c.parentComment } : {}),
        ...(org && c.actor === org ? { mine: true } : {}),
      }));
      return pageOf(rows, q);
    },
    async reply(commentId: string, text: string): Promise<void> {
      // An answer to a comment names its post and the comment as its parent.
      const nested = COMMENT_URN.exec(commentId);
      await sites.call(
        "linkedin",
        "POST",
        `/rest/socialActions/${encodeURIComponent(commentId)}/comments`,
        {
          actor: await me(),
          ...(nested ? { object: nested[1], parentComment: commentId } : {}),
          message: { text },
        },
      );
    },
    ...(org
      ? {
          async audience(): Promise<Audience> {
            const out = await sites.call<{ firstDegreeSize?: number }>(
              "linkedin",
              "GET",
              `/rest/networkSizes/${encodeURIComponent(org)}`,
              { edgeType: "COMPANY_FOLLOWED_BY_MEMBER" },
            );
            return { followers: out.firstDegreeSize ?? 0, asOf: now().toISOString(), raw: out };
          },
        }
      : direct
        ? {}
        : { audience: wrenAudience, activity: notifications, accountInsights: dashboard }),
    // A client's own account has no analytics page here: the Community Management API's.
    async insights(q: InsightsQuery): Promise<Insights> {
      if (direct)
        return {
          values: [],
          gaps: knownGaps(
            "needs_william",
            "LinkedIn post impressions and reach need the Community Management API on Wren's app",
            [M.impressions, M.reach, M.shares, M.profileVisits],
          ),
          asOf: now().toISOString(),
        };
      return analyticsPage(q);
    },
  };

  /**
   * The post's analytics page in the browser, as Wren's account, while the Community Management
   * API (`r_member_postAnalytics`) waits on review. Light: only on the days in
   * `ANALYTICS_DAYS` after it went up, and a day over the box's cap reads nothing. A day with
   * no read writes nothing, so the last read's numbers and state stand.
   */
  async function analyticsPage(q: InsightsQuery): Promise<Insights> {
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
      if (err instanceof SiteCallError && err.status === 429) return { values: [], gaps: [], asOf };
      // A browser read that broke: said where the number sits, never retried as a storm.
      const why = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      into.gaps.push(...knownGaps(gapStateOf(err) ?? "error", why, ANALYTICS_METRICS));
    }
    return { ...into, asOf };
  }

  /**
   * Wren's own dashboard in the browser, as Wren's account, once a day (the metrics loop): profile
   * visits and search appearances. They are the window totals the page shows (LinkedIn's own
   * windows, said in `raw`), kept on the day read. Over the box's cap: nothing read today.
   */
  async function dashboard(): Promise<AccountInsights> {
    const asOf = now().toISOString();
    const day = asOf.slice(0, 10);
    const wanted = [M.profileVisits, M.searchAppearances];
    try {
      const d = await sites.call<Dashboard>(
        "linkedin",
        "GET",
        "/analytics/dashboard",
        {},
        AUDIENCE_ACCOUNT,
      );
      const values: InsightValue[] = [
        ...(typeof d.profileViewers === "number"
          ? [{ metric: M.profileVisits, value: d.profileViewers }]
          : []),
        ...(typeof d.searchAppearances === "number"
          ? [{ metric: M.searchAppearances, value: d.searchAppearances }]
          : []),
      ];
      const read = new Set(values.map((v) => v.metric));
      const missing = wanted.filter((m) => !read.has(m));
      return {
        days: values.length ? [{ day, values }] : [],
        gaps: missing.length
          ? knownGaps("error", "The dashboard showed no number for it", missing)
          : [],
        asOf,
      };
    } catch (err) {
      if (err instanceof SiteCallError && err.status === 429) return { days: [], gaps: [], asOf };
      const why = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      return { days: [], gaps: knownGaps(gapStateOf(err) ?? "error", why, wanted), asOf };
    }
  }

  async function wrenAudience(): Promise<Audience> {
    const out = await sites.call<{ followers: number }>(
      "linkedin",
      "GET",
      "/audience",
      {},
      AUDIENCE_ACCOUNT,
    );
    return { followers: out.followers, asOf: now().toISOString(), raw: out };
  }

  async function notifications(q: ActivityQuery = {}): Promise<ActivityRow[]> {
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
  }
}
