/**
 * YouTube as a `ContentChannel`, over autobrowse's site API in the Data
 * API v3's shape. Publish = a resumable upload of a file the worker can
 * read (a path on the worker or a URL); list = the channel's uploads
 * playlist (cheap in quota); metrics = `videos?part=statistics`.
 */
import {
  type CommentRow,
  type ContentChannel,
  type FetchedWith,
  type ListQuery,
  type MediaHost,
  type Metrics,
  mediaFileOf,
  type Post,
  type Published,
  type PublishedRow,
  pageOf,
  previewOf,
  type SiteClient,
} from "@wren/core/content";

export interface YouTubeContentOptions {
  now?: () => Date;
  /** Makes a laptop file or a stored object reachable from the box; absent = paths are the box's own. */
  host?: MediaHost;
  /** Default privacy for an upload; `extra.privacyStatus` on the post overrides. */
  privacy?: "public" | "unlisted" | "private";
}

const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

interface Video {
  id: string;
  snippet?: { title?: string; description?: string; publishedAt?: string };
  status?: { publishAt?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}
interface PlaylistItem {
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    resourceId?: { videoId?: string };
  };
}
interface CommentThread {
  id?: string;
  snippet?: {
    topLevelComment?: {
      id?: string;
      snippet?: {
        authorDisplayName?: string;
        textOriginal?: string;
        textDisplay?: string;
        publishedAt?: string;
      };
    };
  };
}

export function youtubeContent(sites: SiteClient, o: YouTubeContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("youtube", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const read = <T>(resource: string, query: Record<string, unknown>) =>
    sites.call<T>("youtube", "GET", `/youtube/v3/${resource}`, query);
  let uploads: Promise<string> | null = null;
  const uploadsPlaylist = () => {
    uploads ??= read<{
      items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
    }>("channels", { part: "contentDetails", mine: "true" }).then((r) => {
      const id = r.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!id) throw new Error("youtube: the token's account has no channel");
      return id;
    });
    return uploads;
  };
  return {
    platform: "youtube",
    async publish(post: Post): Promise<Published> {
      if (post.media?.kind !== "video")
        throw new Error(
          "youtube: a post is a video (media.kind = video, media.source = path or URL)",
        );
      const title = (post.extra?.title as string | undefined) ?? post.media.title;
      if (!title) throw new Error("youtube: a title is needed (media.title or extra.title)");
      const v = await sites.call<Video>("youtube", "POST", "/upload/youtube/v3/videos", {
        snippet: {
          title,
          description: post.text,
          ...(Array.isArray(post.extra?.tags) ? { tags: post.extra.tags } : {}),
          ...(post.extra?.categoryId ? { categoryId: post.extra.categoryId } : {}),
        },
        status: {
          privacyStatus:
            (post.extra?.privacyStatus as string | undefined) ?? o.privacy ?? "private",
          ...(post.scheduledFor ? { publishAt: post.scheduledFor } : {}),
        },
        file: await mediaFileOf(post.media.source, o.host, "youtube"),
      });
      return {
        id: v.id,
        url: videoUrl(v.id),
        publishedAt: post.scheduledFor ?? v.snippet?.publishedAt ?? now().toISOString(),
        fetchedWith: await via("POST", "/upload/youtube/v3/videos"),
      };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const r = await read<{ items?: PlaylistItem[] }>("playlistItems", {
        part: "snippet",
        playlistId: await uploadsPlaylist(),
        maxResults: Math.min(q.limit ?? 50, 50),
      });
      const fetchedWith = await via("GET", "/youtube/v3/playlistItems");
      const rows = (r.items ?? []).flatMap((it) => {
        const id = it.snippet?.resourceId?.videoId;
        return id
          ? [
              {
                id,
                url: videoUrl(id),
                publishedAt: it.snippet?.publishedAt ?? now().toISOString(),
                fetchedWith,
                preview: previewOf(it.snippet?.title ?? ""),
              },
            ]
          : [];
      });
      return pageOf(rows, q);
    },
    async metrics(id: string): Promise<Metrics> {
      const r = await read<{ items?: Video[] }>("videos", { part: "statistics", id });
      const s = r.items?.[0]?.statistics;
      if (!s) throw new Error(`youtube: no video ${id}`);
      return {
        id,
        views: Number(s.viewCount ?? 0),
        reactions: Number(s.likeCount ?? 0),
        comments: Number(s.commentCount ?? 0),
        shares: 0,
        asOf: now().toISOString(),
        fetchedWith: await via("GET", "/youtube/v3/videos"),
      };
    },
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      const r = await read<{ items?: CommentThread[] }>("commentThreads", {
        part: "snippet",
        videoId: id,
        maxResults: Math.min(q.limit ?? 100, 100),
        order: "time",
      });
      const rows = (r.items ?? []).flatMap((t) => {
        const c = t.snippet?.topLevelComment;
        const cid = c?.id ?? t.id;
        return cid
          ? [
              {
                id: cid,
                postId: id,
                author: c?.snippet?.authorDisplayName ?? "",
                text: c?.snippet?.textOriginal ?? c?.snippet?.textDisplay ?? "",
                at: c?.snippet?.publishedAt ?? now().toISOString(),
              },
            ]
          : [];
      });
      return pageOf(rows, q);
    },
    async reply(commentId: string, text: string): Promise<void> {
      await sites.call("youtube", "POST", "/youtube/v3/comments", {
        snippet: { parentId: commentId, textOriginal: text },
      });
    },
  };
}
