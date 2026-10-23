/**
 * Instagram through the browser, for the case the Graph API cannot serve:
 * a file on this machine. Publishing on `graph.instagram.com` takes a
 * public URL and a Facebook Page with a professional account linked to
 * it, so without a media host and a Page there is no API path at all —
 * while a signed-in browser posts the file directly. autobrowse answers
 * `POST /web/posts` with its composer flow and guards the account it
 * posts as (`INSTAGRAM_ACCOUNT`), so nothing here knows it is a browser.
 * The box has none of our files: a stored object goes as a signed URL,
 * which the box downloads before it uploads.
 *
 * Reading back is the API's. `list` reads the account's posts on the
 * Instagram login token (`GET /me`, then `/{igUserId}/media`), so a lost
 * publish can be looked for; `metrics` and `comments` want the Graph path
 * and say so plainly.
 */
import {
  type CommentRow,
  type ContentChannel,
  type ListQuery,
  type MediaHost,
  type Metrics,
  mediaFileOf,
  type Post,
  type Published,
  type PublishedRow,
  pageFollowing,
  pageOf,
  previewOf,
  type SiteClient,
} from "@wren/core/content";
import { fieldsOf, ShapeError } from "@wren/core/content/shapes";
import { isCarousel } from "@wren/core/content/slides";

const NO_READ =
  "instagram: reading posts back needs the API (INSTAGRAM_CLIENT_ID/SECRET, then a consent); the browser leg only publishes";

export function instagramWebContent(
  sites: SiteClient,
  o: { now?: () => Date; host?: MediaHost } = {},
): ContentChannel {
  const now = o.now ?? (() => new Date());
  return {
    platform: "instagram",
    // The signed-in page's Following list (the Graph API lists no follows).
    following: () =>
      pageFollowing(sites, "instagram", "/web/following", (h) => `https://www.instagram.com/${h}/`),
    async publish(post: Post): Promise<Published> {
      if (isCarousel({ platform: "instagram", extra: post.extra ?? null }))
        throw new ShapeError("instagram: a carousel posts through the API, not the web composer");
      if (!post.media) throw new Error("instagram: a post is an image or a video");
      // The composer takes a file and a caption: a field it can't set fails, never drops.
      const f = fieldsOf("instagram", post.extra);
      if (f.kind === "story")
        throw new ShapeError("instagram: a story posts through the API, not the web composer");
      const unsent = [
        f.cover && "Cover",
        f.thumbOffset !== undefined && "Cover frame",
        f.collaborators?.length && "Collaborators",
        f.audioName && "Audio name",
        f.shareToFeed === false && "Also in Feed (off)",
      ].filter(Boolean);
      if (unsent.length)
        throw new ShapeError(`instagram: posting through the web can't set ${unsent.join(", ")}`);
      const r = await sites.call<{ url?: string | null }>("instagram", "POST", "/web/posts", {
        file: await mediaFileOf(post.media.source, o.host, "instagram"),
        caption: post.text,
      });
      // The composer confirms the post before the profile lists it; a post
      // with no link yet is still published, and its id is the link when there is one.
      const url = r.url ?? null;
      const id = url ? (/\/(?:p|reel)\/([^/?]+)/.exec(url)?.[1] ?? url) : "";
      if (!id) throw new Error("instagram: the composer published but named no post");
      return { id, url: url ?? "", publishedAt: now().toISOString(), fetchedWith: "browser" };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const me = await sites.call<{ user_id?: string | number }>("instagram", "GET", "/me", {});
      if (!me.user_id) throw new Error("instagram: the token named no account");
      const ig = String(me.user_id);
      const r = await sites.call<{
        data?: Array<{ id: string; caption?: string; permalink?: string; timestamp?: string }>;
      }>("instagram", "GET", `/${ig}/media`, {
        fields: "id,caption,permalink,timestamp",
        limit: Math.min(q.limit ?? 100, 100),
      });
      return pageOf(
        (r.data ?? []).map((m) => ({
          id: m.id,
          url: m.permalink ?? "",
          // Graph's `+0000` offset, made ISO so rows sort and compare by time.
          publishedAt: m.timestamp
            ? new Date(m.timestamp.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")).toISOString()
            : now().toISOString(),
          fetchedWith: "api" as const,
          preview: previewOf(m.caption ?? ""),
          ...(m.caption ? { text: m.caption } : {}),
        })),
        q,
      );
    },
    async metrics(_id: string): Promise<Metrics> {
      throw new Error(NO_READ);
    },
    async comments(_id: string, _q: ListQuery = {}): Promise<CommentRow[]> {
      throw new Error(NO_READ);
    },
  };
}
