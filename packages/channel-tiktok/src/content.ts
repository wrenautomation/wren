/**
 * TikTok as a `ContentChannel` in the Content Posting API's shape: list = the account's videos,
 * metrics = a video's counts. Comments have no self-serve API: the box reads a video's from its
 * page (`/web/videos/{id}/comments`, browser, 24 a day). Audience = `user/info` followers (scope
 * user.info.stats).
 *
 * Publish over a client's connected account (`direct`) follows TikTok's Direct Post rules
 * (`@wren/core/content/tiktok`): creator_info right before, refuse what the creator can't post,
 * send the file by FILE_UPLOAD, then wait on its status. Over autobrowse (Wren's own) it posts
 * from a public URL (PULL_FROM_URL), or with `postVia: "web"` through TikTok Studio in the box's
 * browser (`/web/posts`): an unaudited app's API posts only SELF_ONLY, the browser posts public.
 */
import {
  type Audience,
  type CommentRow,
  type ContentChannel,
  type FetchedWith,
  type Insights,
  type InsightsQuery,
  knownGaps,
  type ListQuery,
  METRICS as M,
  type MediaHost,
  type Metrics,
  mediaFileOf,
  type Post,
  type Published,
  type PublishedRow,
  pageFollowing,
  pageOf,
  previewOf,
  publicUrlOf,
  type SiteClient,
} from "@wren/core/content";
import { type FieldsOf, fieldsOf, ShapeError } from "@wren/core/content/shapes";
import {
  creatorFrom,
  type TikTokCreator,
  type TikTokPrivacy,
  tiktokHold,
} from "@wren/core/content/tiktok";

export interface TikTokContentOptions {
  now?: () => Date;
  host?: MediaHost;
  /** A client's connected account on TikTok's API: the Direct Post path. */
  direct?: boolean;
  /**
   * How Wren's own posts go out (not `direct`): `api` (default) = the Content Posting API;
   * `web` = TikTok Studio in the box's browser, public while the app is unaudited.
   */
  postVia?: "api" | "web";
}

const WEB_POST = "/web/posts";

/** Studio's "Who can see this post", by TikTok's API names; Followers has no web option. */
const WEB_AUDIENCE: Partial<Record<TikTokPrivacy, "everyone" | "friends" | "only-me">> = {
  PUBLIC_TO_EVERYONE: "everyone",
  MUTUAL_FOLLOW_FRIENDS: "friends",
  SELF_ONLY: "only-me",
};

/** What the box's Studio flow answers. */
interface WebPosted {
  id?: string | null;
  url?: string | null;
  profile?: string;
  note?: string;
}

const CREATOR = "/v2/post/publish/creator_info/query/";
const INIT = "/v2/post/publish/video/init/";
const STATUS = "/v2/post/publish/status/fetch/";
/** Seconds one status call waits on TikTok to finish the post. */
const STATUS_WAIT = 120;

/** The creator as TikTok answers it now (20 a minute per token). */
export async function tiktokCreator(sites: SiteClient): Promise<TikTokCreator> {
  return creatorFrom(await sites.call("tiktok", "POST", CREATOR, {}));
}

interface PublishStatus {
  data?: {
    status?: string;
    fail_reason?: string;
    publicaly_available_post_id?: (string | number)[];
  };
}

interface Video {
  id: string;
  title?: string;
  create_time?: number;
  share_url?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

/** One comment as the box reads it off the video's page. */
interface WebComment {
  id: string;
  text: string;
  at: string;
  author: string;
  authorName?: string;
  authorId?: string;
  /** The comment it answers; absent on the video itself. */
  parentId?: string | null;
  /** Written by the video's own account: ours. */
  creator?: boolean;
  likes?: number;
}

/** `video/query` takes up to 20 ids (autobrowse's schema holds the same cap). */
const VIDEOS_PER_QUERY = 20;

export function tiktokContent(sites: SiteClient, o: TikTokContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("tiktok", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const at = (v: Video) => new Date((v.create_time ?? 0) * 1000).toISOString();
  /** These videos' counts, at most `VIDEOS_PER_QUERY` to a call. A video it doesn't know is absent. */
  const query = async (ids: string[]): Promise<Video[]> => {
    const out: Video[] = [];
    for (let i = 0; i < ids.length; i += VIDEOS_PER_QUERY) {
      const r = await sites.call<{ data?: { videos?: Video[] } }>(
        "tiktok",
        "POST",
        "/v2/video/query/",
        { filters: { video_ids: ids.slice(i, i + VIDEOS_PER_QUERY) } },
      );
      out.push(...(r.data?.videos ?? []));
    }
    return out;
  };
  const metricsOf = (v: Video, fetchedWith: FetchedWith): Metrics => ({
    id: v.id,
    views: v.view_count ?? 0,
    reactions: v.like_count ?? 0,
    comments: v.comment_count ?? 0,
    shares: v.share_count ?? 0,
    asOf: now().toISOString(),
    fetchedWith,
  });
  // Studio sets what the form shows: a field it can't set fails, never drops.
  async function publishWeb(post: Post, source: string, f: FieldsOf<"tiktok">): Promise<Published> {
    const privacy = f.privacy ? WEB_AUDIENCE[f.privacy] : undefined;
    if (!privacy)
      throw new ShapeError(
        `tiktok: posting through the web can't set who can see it to ${f.privacy}`,
      );
    const unsent = [
      f.disclose && "Disclose post content",
      f.coverMs !== undefined && "Cover frame",
      !!f.allowDuet !== !!f.allowStitch && "Duet apart from stitch (Studio sets them together)",
    ].filter(Boolean);
    if (unsent.length)
      throw new ShapeError(`tiktok: posting through the web can't set ${unsent.join(", ")}`);
    const r = await sites.call<WebPosted>("tiktok", "POST", WEB_POST, {
      file: await mediaFileOf(source, o.host, "tiktok"),
      caption: post.text.slice(0, 2200),
      privacy,
      comments: !!f.allowComment,
      reuse: !!f.allowDuet && !!f.allowStitch,
      aiGenerated: !!f.aiGenerated,
    });
    const profile = r.profile ?? "https://www.tiktok.com/";
    // Posted but not on the grid yet: still published (a retry would post twice), kept with a note.
    if (!r.id)
      return {
        id: profile,
        url: profile,
        publishedAt: now().toISOString(),
        fetchedWith: "browser",
        notes: [r.note ?? "posted; TikTok had not listed it yet"],
      };
    return {
      id: r.id,
      url: r.url ?? `${profile}/video/${r.id}`,
      publishedAt: now().toISOString(),
      fetchedWith: "browser",
      ...(r.note ? { notes: [r.note] } : {}),
    };
  }
  return {
    platform: "tiktok",
    // The signed-in profile's Following dialog (no TikTok API lists follows).
    following: () =>
      pageFollowing(sites, "tiktok", "/web/following", (h) => `https://www.tiktok.com/@${h}`),
    async publish(post: Post): Promise<Published> {
      if (post.media?.kind !== "video") throw new Error("tiktok: a post is a video");
      const f = fieldsOf("tiktok", post.extra);
      if (!f.privacy) throw new ShapeError("tiktok: pick who can see it first");
      if (!o.direct && o.postVia === "web") return publishWeb(post, post.media.source, f);
      const creator = o.direct ? await tiktokCreator(sites) : null;
      if (creator) {
        const hold = tiktokHold(f, creator);
        if (hold) throw new ShapeError(`tiktok: ${hold}`);
      }
      const url = await publicUrlOf(post.media.source, o.host, "tiktok");
      const post_info = {
        title: post.text.slice(0, 2200),
        privacy_level: f.privacy,
        // Off where the creator turned it off, whatever was picked.
        disable_comment: !f.allowComment || !!creator?.commentOff,
        disable_duet: !f.allowDuet || !!creator?.duetOff,
        disable_stitch: !f.allowStitch || !!creator?.stitchOff,
        brand_organic_toggle: !!(f.disclose && f.yourBrand),
        brand_content_toggle: !!(f.disclose && f.brandedContent),
        ...(f.coverMs !== undefined ? { video_cover_timestamp_ms: f.coverMs } : {}),
        ...(f.aiGenerated !== undefined ? { is_aigc: f.aiGenerated } : {}),
      };
      const r = await sites.call<{ data?: { publish_id?: string } }>(
        "tiktok",
        "POST",
        INIT,
        creator
          ? {
              post_info,
              file: url,
              ...(creator.maxVideoSec ? { maxSeconds: creator.maxVideoSec } : {}),
            }
          : { post_info, source_info: { source: "PULL_FROM_URL", video_url: url } },
      );
      const id = r.data?.publish_id;
      if (!id) throw new Error("tiktok: the publish answered no id");
      const fetchedWith = await via("POST", INIT);
      const profile = creator?.username
        ? `https://www.tiktok.com/@${creator.username}`
        : "https://www.tiktok.com/";
      // Wren's own posts ask too: autobrowse waits the same way a client's call does.
      const s = await sites.call<PublishStatus>("tiktok", "POST", STATUS, {
        publish_id: id,
        wait: STATUS_WAIT,
      });
      if (s.data?.status === "FAILED")
        throw new Error(`tiktok: the post failed (${s.data.fail_reason ?? "no reason given"})`);
      // A public post has its id once done; a private one or one still processing keeps the publish id.
      const postId = s.data?.publicaly_available_post_id?.[0];
      return postId !== undefined
        ? {
            id: String(postId),
            url: creator?.username
              ? `${profile}/video/${postId}`
              : `https://m.tiktok.com/v/${postId}.html`,
            publishedAt: now().toISOString(),
            fetchedWith,
          }
        : { id, url: profile, publishedAt: now().toISOString(), fetchedWith };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const r = await sites.call<{ data?: { videos?: Video[] } }>(
        "tiktok",
        "POST",
        "/v2/video/list/",
        { max_count: Math.min(q.limit ?? 20, 20) },
      );
      const fetchedWith = await via("POST", "/v2/video/list/");
      return pageOf(
        (r.data?.videos ?? []).map((v) => ({
          id: v.id,
          url: v.share_url ?? "https://www.tiktok.com/",
          publishedAt: at(v),
          fetchedWith,
          preview: previewOf(v.title ?? ""),
          ...(v.title ? { text: v.title } : {}),
        })),
        q,
      );
    },
    async metrics(id: string): Promise<Metrics> {
      const v = (await query([id]))[0];
      if (!v) throw new Error(`tiktok: no video ${id}`);
      return metricsOf({ ...v, id }, await via("POST", "/v2/video/query/"));
    },
    /** `video/query` takes 20 ids a call, where a post was one call each. */
    async metricsMany(posts: { id: string }[]): Promise<Metrics[]> {
      const videos = await query(posts.map((p) => p.id));
      if (!videos.length) return [];
      const fetchedWith = await via("POST", "/v2/video/query/");
      return videos.map((v) => metricsOf(v, fetchedWith));
    },
    /**
     * Counts from the same query. Comments themselves come off the page in a browser, a capped
     * read: a post is opened only when its count moved.
     */
    async commentCounts(ids: string[]): Promise<Record<string, number>> {
      const out: Record<string, number> = {};
      for (const v of await query(ids))
        if (typeof v.comment_count === "number") out[v.id] = v.comment_count;
      return out;
    },
    // Newest first, as the page lists them; ours (the creator's) come back marked.
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      if (!/^[0-9]+$/.test(id)) return [];
      const r = await sites.call<{ url?: string; comments?: WebComment[] }>(
        "tiktok",
        "GET",
        `/web/videos/${id}/comments`,
        { max: Math.min(q.limit ?? 50, 100) },
      );
      return pageOf(
        (r.comments ?? []).map((c) => ({
          id: c.id,
          postId: id,
          author: c.author || c.authorId || "someone",
          text: c.text,
          // A comment the page gave no time: now, so it still sorts and counts.
          at: c.at || now().toISOString(),
          ...(c.parentId ? { parentId: c.parentId } : {}),
          ...(r.url ? { url: r.url } : {}),
          ...(c.creator ? { mine: true } : {}),
          raw: c,
        })),
        q,
      );
    },
    async audience(): Promise<Audience> {
      const r = await sites.call<{ data?: { user?: { follower_count?: number } } }>(
        "tiktok",
        "GET",
        "/v2/user/info/",
        { fields: "open_id,follower_count" },
      );
      const n = r.data?.user?.follower_count;
      if (typeof n !== "number")
        throw new Error("tiktok: no follower count (the token needs user.info.stats)");
      return { followers: n, asOf: now().toISOString(), raw: r.data?.user };
    },
    // The Display API answers counts only (`metrics`); the rest is the Business API's.
    async insights(_q: InsightsQuery): Promise<Insights> {
      return {
        values: [],
        gaps: knownGaps(
          "needs_william",
          "TikTok gives reach, watch time and saves in its Business API, which needs a TikTok for Business account",
          [M.reach, M.avgViewSecs, M.retention, M.trafficSource, M.saves, M.profileVisits],
        ),
        asOf: now().toISOString(),
      };
    },
  };
}
