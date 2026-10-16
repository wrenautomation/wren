/**
 * Instagram and a Facebook Page as `ContentChannel`s, both over
 * autobrowse's `meta` site (one Facebook Login app, graph.facebook.com).
 * Instagram publishes the Page's professional account in two Graph calls
 * (a container from a public URL, then publish); Facebook posts text, a
 * photo or a video to the Page. A local media file is hosted first
 * (`MediaHost`) because the Graph API only takes URLs. Instagram's
 * activity (media we're tagged in) and audience come from one read of the
 * IG user.
 */
import {
  type AccountInsights,
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
  type MediaHost,
  type Metrics,
  numberOf,
  type Post,
  type Published,
  type PublishedRow,
  pageOf,
  previewOf,
  publicUrlOf,
  readGroup,
  type SiteClient,
} from "@wren/core/content";
import { fieldsOf } from "@wren/core/content/shapes";
import { carouselFiles, isCarousel } from "@wren/core/content/slides";
import { VIDEO_WAITS_MS } from "./poll.js";

export interface MetaContentOptions {
  now?: () => Date;
  /** Hosts a local file as a public URL; without it media must already be a URL. */
  host?: MediaHost;
  /** The Page (`me/accounts` lists them); the first Page when absent. */
  pageId?: string;
  /**
   * The Page's Instagram account. With `pageId` too, nothing is listed: Instagram needs both to
   * skip the `me/accounts` read, Facebook needs `pageId` alone.
   */
  igId?: string;
  /** Between the container and its publish: the Graph API needs a moment for a video. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Read a Page's comments: its token holds `pages_read_user_content` (a client's connected
   * Page). Off, a Page reads none.
   */
  pageComments?: boolean;
}

interface Page {
  id: string;
  name?: string;
  instagram_business_account?: { id: string };
}
interface Edge<T> {
  data?: T[];
}

/**
 * The Page, and the Page with its Instagram account. Configured ids answer without a call;
 * otherwise `me/accounts` is read once per channel.
 */
function pageOf_(sites: SiteClient, o: MetaContentOptions) {
  let listed: Promise<Page> | null = null;
  const list = () => {
    listed ??= sites.call<Edge<Page>>("meta", "GET", "/me/accounts", {}).then((r) => {
      const pages = r.data ?? [];
      const hit = o.pageId ? pages.find((p) => p.id === o.pageId) : pages[0];
      if (!hit)
        throw new Error(
          o.pageId
            ? `meta: no Page ${o.pageId} on this account`
            : "meta: the account admins no Page",
        );
      return hit;
    });
    return listed;
  };
  const known = (): Page | null =>
    o.pageId
      ? { id: o.pageId, ...(o.igId ? { instagram_business_account: { id: o.igId } } : {}) }
      : null;
  return {
    page: (): Promise<Page> => {
      const p = known();
      return p ? Promise.resolve(p) : list();
    },
    withIg: (): Promise<Page> => {
      const p = known();
      return p?.instagram_business_account ? Promise.resolve(p) : list();
    },
  };
}

/**
 * One DM to a comment's author through the Page (Private Replies, Instagram and Facebook alike):
 * Meta allows one per comment, within 7 days of it.
 */
async function privateReply(
  sites: SiteClient,
  page: () => Promise<Page>,
  commentId: string,
  text: string,
): Promise<{ ref: string | null }> {
  const { id } = await page();
  const r = await sites.call<{ message_id?: string }>("meta", "POST", `/${id}/messages`, {
    recipient: { comment_id: commentId },
    message: { text },
  });
  return { ref: r.message_id ?? null };
}

const IG_FIELDS = "id,caption,media_type,permalink,timestamp,like_count,comments_count";
/** The tags edge comes as a field expansion on the IG user, so no route beyond `/{objectId}`. */
const IG_INBOX_FIELDS = "followers_count,tags.limit(25){id,caption,permalink,timestamp,username}";

interface IgInbox {
  followers_count?: number;
  tags?: Edge<{
    id: string;
    caption?: string;
    permalink?: string;
    timestamp?: string;
    username?: string;
  }>;
}

/** One Graph insight: a period's `values` or a `total_value`. */
interface Insight {
  name: string;
  values?: Array<{ value?: unknown }>;
  total_value?: { value?: unknown };
}
const insightValue = (i: Insight | undefined) => i?.total_value?.value ?? i?.values?.[0]?.value;

/** A post's insights answer kept for `insights`: the metrics it asked for, and what came back. */
interface IgRead {
  igMetrics: string[];
  data: Insight[];
}
/** The answer a look's counts read kept, if it asked for exactly `names`. */
function igReadOf(read: unknown, names: string[]): Insight[] | undefined {
  const r = read as Partial<IgRead> | null | undefined;
  if (!r || !Array.isArray(r.igMetrics) || !Array.isArray(r.data)) return undefined;
  return r.igMetrics.length === names.length && r.igMetrics.every((n, i) => n === names[i])
    ? r.data
    : undefined;
}

/** Graph's names to ours, with a scale (watch time comes in milliseconds). */
const IG_METRICS: Record<string, [string, number]> = {
  reach: [M.reach, 1],
  views: [M.views, 1],
  saved: [M.saves, 1],
  likes: [M.likes, 1],
  comments: [M.comments, 1],
  shares: [M.shares, 1],
  total_interactions: [M.interactions, 1],
  follows: [M.follows, 1],
  profile_visits: [M.profileVisits, 1],
  ig_reels_avg_watch_time: [M.avgViewSecs, 1 / 1000],
  ig_reels_video_view_total_time: [M.watchMinutes, 1 / 60_000],
};
const COMMON = ["reach", "views", "saved", "likes", "comments", "shares", "total_interactions"];
/** A Reel answers watch time and refuses follows; a feed post the other way round. */
export const igMetricsFor = (kind: string | null | undefined): string[] =>
  kind === "carousel" || kind === "image"
    ? [...COMMON, "follows", "profile_visits"]
    : [...COMMON, "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"];
const IG_APP_ONLY = "Instagram shows this in the app only";
/** The account's day numbers, as a field expansion on the IG user (no route beyond `/{objectId}`). */
const IG_ACCOUNT: Record<string, string> = {
  reach: M.reach,
  profile_views: M.profileVisits,
  website_clicks: M.linkClicks,
  accounts_engaged: M.accountsEngaged,
};

export function instagramContent(sites: SiteClient, o: MetaContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pages = pageOf_(sites, o);
  const igUser = async () => {
    const p = await pages.withIg();
    if (!p.instagram_business_account?.id)
      throw new Error(`meta: Page ${p.id} has no Instagram professional account linked`);
    return p.instagram_business_account.id;
  };
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("meta", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const IG_COMMENT_FIELDS = "id,text,username,timestamp,from{id}";
  const inbox = async () =>
    sites.call<IgInbox>("meta", "GET", `/${await igUser()}`, { fields: IG_INBOX_FIELDS });
  const fetchInsights = (id: string, metric: string[]) =>
    sites.call<Edge<Insight>>("meta", "GET", `/${id}/insights`, { metric: metric.join(",") });
  const igMetrics = (
    id: string,
    data: Insight[] | undefined,
    read: IgRead | undefined,
    fetchedWith: FetchedWith,
  ): Metrics => {
    const val = (name: string) => Number(insightValue(data?.find((m) => m.name === name))) || 0;
    return {
      id,
      views: val("reach"),
      reactions: val("likes"),
      comments: val("comments"),
      shares: val("shares"),
      ...(read ? { read } : {}),
      asOf: now().toISOString(),
      fetchedWith,
    };
  };
  /** Waits out a video container: FINISHED goes on, ERROR or EXPIRED stops with Graph's words. */
  const ready = async (id: string): Promise<void> => {
    for (const wait of VIDEO_WAITS_MS) {
      await sleep(wait);
      const c = await sites.call<{ status_code?: string; status?: string }>(
        "meta",
        "GET",
        `/${id}`,
        {
          fields: "status_code,status",
        },
      );
      if (c.status_code === "FINISHED" || c.status_code === "PUBLISHED") return;
      if (c.status_code === "ERROR" || c.status_code === "EXPIRED")
        throw new Error(`instagram: the video was refused (${c.status ?? c.status_code})`);
    }
    throw new Error("instagram: the video was still processing after 5 minutes");
  };
  const published = async (id: string): Promise<Published> => ({
    id,
    url: `https://www.instagram.com/p/${id}/`,
    publishedAt: now().toISOString(),
    fetchedWith: await via("POST", "/{igUserId}/media_publish"),
  });
  /**
   * A carousel: one child container per drawn slide (JPEG, `is_carousel_item`), then the
   * parent (`CAROUSEL`, the children's ids, the caption), then publish. Answers the post's id.
   */
  async function carousel(ig: string, post: Post, collaborators?: string[]): Promise<string> {
    const { images } = carouselFiles({ extra: post.extra ?? null });
    if (images.length < 2 || images.length > 10)
      throw new Error(`instagram: a carousel is 2 to 10 images, not ${images.length}`);
    const children: string[] = [];
    for (const key of images) {
      const c = await sites.call<{ id?: string }>("meta", "POST", `/${ig}/media`, {
        image_url: await publicUrlOf(key, o.host, "instagram"),
        is_carousel_item: true,
      });
      if (!c.id) throw new Error("instagram: a carousel item answered no id");
      children.push(c.id);
    }
    const parent = await sites.call<{ id?: string }>("meta", "POST", `/${ig}/media`, {
      media_type: "CAROUSEL",
      children,
      caption: post.text,
      ...(collaborators?.length ? { collaborators } : {}),
    });
    if (!parent.id) throw new Error("instagram: the carousel container answered no id");
    const r = await sites.call<{ id?: string }>("meta", "POST", `/${ig}/media_publish`, {
      creation_id: parent.id,
    });
    if (!r.id) throw new Error("instagram: publish answered no id");
    return r.id;
  }
  /** A story: one image or 9:16 video, no caption (the API takes none); gone in a day. */
  async function story(ig: string, media: NonNullable<Post["media"]>): Promise<Published> {
    const url = await publicUrlOf(media.source, o.host, "instagram");
    const video = media.kind === "video";
    const container = await sites.call<{ id?: string }>("meta", "POST", `/${ig}/media`, {
      ...(video ? { video_url: url } : { image_url: url }),
      media_type: "STORIES",
    });
    if (!container.id) throw new Error("instagram: the story container answered no id");
    if (video) await ready(container.id);
    const r = await sites.call<{ id?: string }>("meta", "POST", `/${ig}/media_publish`, {
      creation_id: container.id,
    });
    if (!r.id) throw new Error("instagram: publish answered no id");
    const id = r.id;
    // A story's link names the account: read it back, never fail the post over it.
    const link = await sites
      .call<{ permalink?: string }>("meta", "GET", `/${id}`, { fields: "permalink" })
      .then((m) => m.permalink ?? null)
      .catch(() => null);
    return {
      id,
      url: link ?? "https://www.instagram.com/",
      publishedAt: now().toISOString(),
      fetchedWith: await via("POST", "/{igUserId}/media_publish"),
    };
  }
  return {
    platform: "instagram",
    async publish(post: Post): Promise<Published> {
      const f = fieldsOf("instagram", post.extra);
      const ig = await igUser();
      if (isCarousel({ platform: "instagram", extra: post.extra ?? null }))
        return published(await carousel(ig, post, f.collaborators));
      if (!post.media) throw new Error("instagram: a post is an image or a video");
      if (f.kind === "story") return story(ig, post.media);
      const url = await publicUrlOf(post.media.source, o.host, "instagram");
      const video = post.media.kind === "video";
      const reel = video
        ? {
            ...(f.cover ? { cover_url: await publicUrlOf(f.cover, o.host, "instagram") } : {}),
            ...(f.thumbOffset !== undefined ? { thumb_offset: f.thumbOffset } : {}),
            ...(f.audioName ? { audio_name: f.audioName } : {}),
          }
        : {};
      const container = await sites.call<{ id?: string }>("meta", "POST", `/${ig}/media`, {
        ...(video ? { video_url: url, media_type: "REELS" } : { image_url: url }),
        caption: post.text,
        ...(f.shareToFeed === false ? { share_to_feed: false } : {}),
        ...(f.collaborators?.length ? { collaborators: f.collaborators } : {}),
        ...reel,
      });
      if (!container.id) throw new Error("instagram: the container answered no id");
      // A video container is ready once Graph has fetched and processed it.
      if (video) await ready(container.id);
      const r = await sites.call<{ id?: string }>("meta", "POST", `/${ig}/media_publish`, {
        creation_id: container.id,
      });
      if (!r.id) throw new Error("instagram: publish answered no id");
      return published(r.id);
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const ig = await igUser();
      const r = await sites.call<
        Edge<{ id: string; caption?: string; permalink?: string; timestamp?: string }>
      >("meta", "GET", `/${ig}/media`, {
        fields: IG_FIELDS,
        limit: Math.min(q.limit ?? 100, 100),
      });
      const fetchedWith = await via("GET", "/{igUserId}/media");
      return pageOf(
        (r.data ?? []).map((m) => ({
          id: m.id,
          url: m.permalink ?? `https://www.instagram.com/p/${m.id}/`,
          publishedAt: m.timestamp ?? now().toISOString(),
          fetchedWith,
          preview: previewOf(m.caption ?? ""),
        })),
        q,
      );
    },
    async metrics(id: string): Promise<Metrics> {
      const r = await sites.call<Edge<Insight>>("meta", "GET", `/${id}/insights`, {
        metric: "reach,likes,comments,shares",
      });
      // No `follows` here: a Reel refuses it, and `insights` reads it for a feed post.
      return igMetrics(id, r.data, undefined, await via("GET", "/{mediaId}/insights"));
    },
    /**
     * One insights call a post, not two: the kind's whole metric list is asked once, its counts
     * are the look's and the answer rides on as `read` for `insights`. A post whose list is
     * refused (a kind it doesn't fit) is left out, and the caller's `metrics` + `insights` read
     * it the careful way.
     */
    async metricsMany(posts: { id: string; kind?: string | null }[]): Promise<Metrics[]> {
      const out: Metrics[] = [];
      for (const p of posts) {
        const names = igMetricsFor(p.kind);
        let data: Insight[] | undefined;
        try {
          data = (await fetchInsights(p.id, names)).data;
        } catch {
          continue;
        }
        const read: IgRead = { igMetrics: names, data: data ?? [] };
        out.push(igMetrics(p.id, data, read, await via("GET", "/{mediaId}/insights")));
      }
      return out;
    },
    /** The newest 100 media with their comment counts, in one listing. */
    async commentCounts(ids: string[]): Promise<Record<string, number>> {
      const r = await sites.call<Edge<{ id: string; comments_count?: number }>>(
        "meta",
        "GET",
        `/${await igUser()}/media`,
        { fields: "id,comments_count", limit: 100 },
      );
      const want = new Set(ids);
      const out: Record<string, number> = {};
      for (const m of r.data ?? [])
        if (want.has(m.id) && typeof m.comments_count === "number") out[m.id] = m.comments_count;
      return out;
    },
    // Replies come with each comment (Instagram nests one level: a reply to a reply sits under
    // the same comment), so a follow-up under a comment is read in the same call.
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      type IgComment = {
        id: string;
        text?: string;
        username?: string;
        timestamp?: string;
        from?: { id?: string };
        replies?: Edge<IgComment>;
      };
      const r = await sites
        .call<Edge<IgComment>>("meta", "GET", `/${id}/comments`, {
          // Without fields the Graph API leaves out who wrote it.
          fields: `${IG_COMMENT_FIELDS},replies{${IG_COMMENT_FIELDS}}`,
          limit: Math.min(q.limit ?? 100, 100),
        })
        .catch((err: unknown) => {
          // A story takes no comments: Graph answers code 10, and there is nothing to read.
          if (isStoryMedia(err)) return { data: [] } as Edge<IgComment>;
          throw err;
        });
      const self = await igUser().catch(() => null);
      const row = (c: IgComment, parentId?: string): CommentRow => ({
        id: c.id,
        postId: id,
        author: c.username ?? "",
        text: c.text ?? "",
        at: c.timestamp ?? now().toISOString(),
        ...(parentId ? { parentId } : {}),
        ...(self && c.from?.id === self ? { mine: true } : {}),
      });
      return pageOf(
        (r.data ?? []).flatMap((c) => [
          row(c),
          ...(c.replies?.data ?? []).map((reply) => row(reply, c.id)),
        ]),
        q,
      );
    },
    async reply(commentId: string, text: string): Promise<void> {
      await sites.call("meta", "POST", `/${commentId}/replies`, { message: text });
    },
    privateReply: (commentId: string, text: string) =>
      privateReply(sites, pages.page, commentId, text),
    async activity(q: ActivityQuery = {}): Promise<ActivityRow[]> {
      const r = await inbox();
      const rows = (r.tags?.data ?? []).map((m) => ({
        id: m.id,
        kind: "mention" as const,
        actor: m.username ?? null,
        actorUrl: m.username ? `https://www.instagram.com/${m.username}/` : null,
        text: (m.caption ?? "").split("\n")[0] ?? "",
        url: m.permalink ?? null,
        at: m.timestamp ?? null,
        raw: m,
      }));
      const { since } = q;
      return rows
        .filter((a) => !since || a.at === null || a.at >= since)
        .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
        .slice(0, q.limit ?? rows.length);
    },
    async audience(): Promise<Audience> {
      const r = await inbox();
      return { followers: r.followers_count ?? 0, asOf: now().toISOString(), raw: r };
    },
    async insights(q: InsightsQuery): Promise<Insights> {
      const out: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      const names = igMetricsFor(q.kind);
      // This look's counts read may already hold the whole list (`metricsMany`).
      const given = igReadOf(q.read, names);
      const ask = async (metric: string[]) => {
        const data = given && metric === names ? given : (await fetchInsights(q.id, metric)).data;
        return metric.flatMap((n) => {
          const [ours, scale] = IG_METRICS[n] as [string, number];
          const v = Number(insightValue(data?.find((d) => d.name === n)));
          return Number.isFinite(v) ? numberOf(ours, v * scale) : [];
        });
      };
      const all = names.map((n) => (IG_METRICS[n] as [string, number])[0]);
      const got = await readGroup(all, () => ask(names), out);
      // One metric this media refuses fails the whole call: ask each alone, keep what answers.
      if (!got && out.gaps.some((g) => g.state === "error")) {
        out.gaps.length = 0;
        for (const n of names)
          await readGroup([(IG_METRICS[n] as [string, number])[0]], () => ask([n]), out);
      }
      out.gaps.push(
        ...knownGaps("no_api", IG_APP_ONLY, [M.retention, M.trafficSource, M.skipRate]),
      );
      return { ...out, asOf: now().toISOString() };
    },
    async accountInsights(): Promise<AccountInsights> {
      const out: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      // Yesterday, whole: today's numbers are still moving.
      const until = new Date(`${now().toISOString().slice(0, 10)}T00:00:00Z`);
      const since = new Date(until.getTime() - 86_400_000);
      const sec = (d: Date) => Math.floor(d.getTime() / 1000);
      const ig = await igUser();
      await readGroup(
        Object.values(IG_ACCOUNT),
        async () => {
          const r = await sites.call<{ insights?: Edge<Insight> }>("meta", "GET", `/${ig}`, {
            fields: `insights.metric(${Object.keys(IG_ACCOUNT).join(",")}).period(day).metric_type(total_value).since(${sec(since)}).until(${sec(until)})`,
          });
          return Object.entries(IG_ACCOUNT).flatMap(([theirs, ours]) =>
            numberOf(ours, insightValue(r.insights?.data?.find((d) => d.name === theirs))),
          );
        },
        out,
      );
      return {
        days: out.values.length
          ? [{ day: since.toISOString().slice(0, 10), values: out.values }]
          : [],
        gaps: out.gaps,
        asOf: now().toISOString(),
      };
    },
  };
}

interface FbPost {
  shares?: { count?: number };
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  insights?: Edge<{ name: string; values?: Array<{ value?: number }> }>;
}
/** What a look reads of a Page post; the Page's listing takes the same fields. */
const FB_STATS =
  "shares,likes.summary(true),comments.summary(true),insights.metric(post_impressions)";

export function facebookContent(sites: SiteClient, o: MetaContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const { page } = pageOf_(sites, o);
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("meta", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const urlOf = (postId: string) => `https://www.facebook.com/${postId}`;
  const fbMetrics = (id: string, r: FbPost, fetchedWith: FetchedWith): Metrics => ({
    id,
    views: r.insights?.data?.find((m) => m.name === "post_impressions")?.values?.[0]?.value ?? 0,
    reactions: r.likes?.summary?.total_count ?? 0,
    comments: r.comments?.summary?.total_count ?? 0,
    shares: r.shares?.count ?? 0,
    asOf: now().toISOString(),
    fetchedWith,
  });
  /** The Page's newest posts (100 is a page) with the numbers a look reads. */
  const recent = async (): Promise<Array<FbPost & { id: string }>> => {
    const r = await sites.call<Edge<FbPost & { id: string }>>(
      "meta",
      "GET",
      `/${(await page()).id}/posts`,
      { fields: `id,${FB_STATS}`, limit: 100 },
    );
    return r.data ?? [];
  };
  return {
    platform: "facebook",
    async publish(post: Post): Promise<Published> {
      const { link, kind } = fieldsOf("facebook", post.extra);
      const p = await page();
      let r: { id?: string; post_id?: string };
      let path: string;
      if (kind === "story") {
        if (!post.media) throw new Error("facebook: a story is an image or a video");
        const url = await publicUrlOf(post.media.source, o.host, "facebook");
        const video = post.media.kind === "video";
        path = video ? "/{pageId}/video_stories" : "/{pageId}/photo_stories";
        r = await sites.call("meta", "POST", `/${p.id}/${video ? "video" : "photo"}_stories`, {
          ...(video ? { file_url: url } : { url }),
        });
      } else if (!post.media) {
        path = "/{pageId}/feed";
        r = await sites.call("meta", "POST", `/${p.id}/feed`, {
          message: post.text,
          ...(link ? { link } : {}),
          ...(post.scheduledFor
            ? {
                published: false,
                scheduled_publish_time: Math.floor(new Date(post.scheduledFor).getTime() / 1000),
              }
            : {}),
        });
      } else {
        const url = await publicUrlOf(post.media.source, o.host, "facebook");
        if (post.media.kind === "video") {
          path = "/{pageId}/videos";
          r = await sites.call("meta", "POST", `/${p.id}/videos`, {
            file_url: url,
            description: post.text,
            ...(post.media.title ? { title: post.media.title } : {}),
          });
        } else {
          path = "/{pageId}/photos";
          r = await sites.call("meta", "POST", `/${p.id}/photos`, { url, message: post.text });
        }
      }
      const id = r.post_id ?? r.id;
      if (!id) throw new Error("facebook: the post answered no id");
      return {
        id,
        url: urlOf(id),
        publishedAt: post.scheduledFor ?? now().toISOString(),
        fetchedWith: await via("POST", path),
      };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const p = await page();
      const r = await sites.call<
        Edge<{ id: string; message?: string; created_time?: string; permalink_url?: string }>
      >("meta", "GET", `/${p.id}/posts`, { limit: Math.min(q.limit ?? 100, 100) });
      const fetchedWith = await via("GET", "/{pageId}/posts");
      return pageOf(
        (r.data ?? []).map((m) => ({
          id: m.id,
          url: m.permalink_url ?? urlOf(m.id),
          publishedAt: m.created_time ?? now().toISOString(),
          fetchedWith,
          preview: previewOf(m.message ?? ""),
        })),
        q,
      );
    },
    async metrics(id: string): Promise<Metrics> {
      const r = await sites.call<FbPost>("meta", "GET", `/${id}`, { fields: FB_STATS });
      return fbMetrics(id, r, await via("GET", "/{objectId}"));
    },
    /**
     * The Page's newest 100 posts with the same numbers `metrics` asks for, in one listing. A
     * post the page doesn't hold (a video's id is not its post's) is left out for `metrics`.
     */
    async metricsMany(posts: { id: string }[]): Promise<Metrics[]> {
      const want = new Set(posts.map((p) => p.id));
      const fetchedWith = await via("GET", "/{pageId}/posts");
      return (await recent())
        .filter((m) => want.has(m.id))
        .map((m) => fbMetrics(m.id, m, fetchedWith));
    },
    /**
     * Counts from the same listing, but only where `comments` reads anything: a Page whose token
     * can't read comments reads none, so every post counts 0 without a call.
     */
    async commentCounts(ids: string[]): Promise<Record<string, number>> {
      if (!o.pageComments) return Object.fromEntries(ids.map((id) => [id, 0]));
      const want = new Set(ids);
      const out: Record<string, number> = {};
      for (const m of await recent())
        if (want.has(m.id) && typeof m.comments?.summary?.total_count === "number")
          out[m.id] = m.comments.summary.total_count;
      return out;
    },
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      // Page comments need `pages_read_user_content`: a connected Page's token has it.
      if (!o.pageComments) return [];
      const r = await sites.call<
        Edge<{
          id: string;
          message?: string;
          from?: { id?: string; name?: string };
          parent?: { id?: string };
          created_time?: string;
        }>
      >("meta", "GET", `/${id}/comments`, {
        fields: "id,message,from{id,name},parent{id},created_time",
        filter: "stream",
        limit: Math.min(q.limit ?? 100, 100),
      });
      // The Page's own answers come back in the stream: kept as ours, never in the Inbox. A Page
      // post's id starts with its Page's.
      const own = o.pageId ?? id.split("_")[0];
      return pageOf(
        (r.data ?? []).map((c) => ({
          id: c.id,
          postId: id,
          author: c.from?.name ?? "",
          text: c.message ?? "",
          at: c.created_time ?? now().toISOString(),
          ...(c.parent?.id ? { parentId: c.parent.id } : {}),
          ...(c.from?.id && c.from.id === own ? { mine: true } : {}),
        })),
        q,
      );
    },
    async reply(commentId: string, text: string): Promise<void> {
      // The Page answers by its own token, so the call names it: a Page post's ids start with its.
      const pageId = o.pageId ?? commentId.split("_")[0];
      await sites.call("meta", "POST", `/${commentId}/comments`, { pageId, message: text });
    },
    privateReply: (commentId: string, text: string) => privateReply(sites, page, commentId, text),
  };
}

/** Graph's answer for a comments read on story media (code 10): a story takes no comments. */
export function isStoryMedia(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /graph code 10\b/.test(text) && /story media/i.test(text);
}
