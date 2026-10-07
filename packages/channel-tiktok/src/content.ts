/**
 * TikTok as a `ContentChannel`, over autobrowse's `tiktok` site in the
 * Content Posting API's shape: publish = a video from a public URL (a local
 * file is hosted first), list = the account's videos, metrics = a video's
 * counts. Comments have no self-serve API: an empty page.
 */
import {
  type CommentRow,
  type ContentChannel,
  type FetchedWith,
  type ListQuery,
  type MediaHost,
  type Metrics,
  type Post,
  type Published,
  type PublishedRow,
  pageOf,
  previewOf,
  publicUrlOf,
  type SiteClient,
} from "@wren/core/content";
import { fieldsOf } from "@wren/core/content/shapes";

export interface TikTokContentOptions {
  now?: () => Date;
  host?: MediaHost;
  /** Who may see it; `extra.privacy` on the post overrides. */
  privacy?: "PUBLIC_TO_EVERYONE" | "MUTUALLY_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
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

export function tiktokContent(sites: SiteClient, o: TikTokContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("tiktok", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const at = (v: Video) => new Date((v.create_time ?? 0) * 1000).toISOString();
  return {
    platform: "tiktok",
    async publish(post: Post): Promise<Published> {
      if (post.media?.kind !== "video") throw new Error("tiktok: a post is a video");
      const f = fieldsOf("tiktok", post.extra);
      const url = await publicUrlOf(post.media.source, o.host, "tiktok");
      const r = await sites.call<{ data?: { publish_id?: string } }>(
        "tiktok",
        "POST",
        "/v2/post/publish/video/init/",
        {
          post_info: {
            title: post.text.slice(0, 2200),
            privacy_level: f.privacy ?? o.privacy ?? "SELF_ONLY",
            ...(f.noComment !== undefined ? { disable_comment: f.noComment } : {}),
            ...(f.noDuet !== undefined ? { disable_duet: f.noDuet } : {}),
            ...(f.noStitch !== undefined ? { disable_stitch: f.noStitch } : {}),
            ...(f.coverMs !== undefined ? { video_cover_timestamp_ms: f.coverMs } : {}),
            ...(f.aiGenerated !== undefined ? { is_aigc: f.aiGenerated } : {}),
            ...(f.brandContent !== undefined ? { brand_content_toggle: f.brandContent } : {}),
            ...(f.brandOrganic !== undefined ? { brand_organic_toggle: f.brandOrganic } : {}),
          },
          source_info: { source: "PULL_FROM_URL", video_url: url },
        },
      );
      const id = r.data?.publish_id;
      if (!id) throw new Error("tiktok: the publish answered no id");
      return {
        id,
        url: `https://www.tiktok.com/`,
        publishedAt: now().toISOString(),
        fetchedWith: await via("POST", "/v2/post/publish/video/init/"),
      };
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
        })),
        q,
      );
    },
    async metrics(id: string): Promise<Metrics> {
      const r = await sites.call<{ data?: { videos?: Video[] } }>(
        "tiktok",
        "POST",
        "/v2/video/query/",
        { filters: { video_ids: [id] } },
      );
      const v = r.data?.videos?.[0];
      if (!v) throw new Error(`tiktok: no video ${id}`);
      return {
        id,
        views: v.view_count ?? 0,
        reactions: v.like_count ?? 0,
        comments: v.comment_count ?? 0,
        shares: v.share_count ?? 0,
        asOf: now().toISOString(),
        fetchedWith: await via("POST", "/v2/video/query/"),
      };
    },
    async comments(): Promise<CommentRow[]> {
      return [];
    },
  };
}
