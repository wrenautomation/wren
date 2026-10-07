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
 * Reading back is still the API's: the composer has no listing route, so
 * `list`, `metrics` and `comments` want the token and say so plainly.
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
  type SiteClient,
} from "@wren/core/content";
import { fieldsOf, ShapeError } from "@wren/core/content/shapes";

const NO_READ =
  "instagram: reading posts back needs the API (INSTAGRAM_CLIENT_ID/SECRET, then a consent); the browser leg only publishes";

export function instagramWebContent(
  sites: SiteClient,
  o: { now?: () => Date; host?: MediaHost } = {},
): ContentChannel {
  const now = o.now ?? (() => new Date());
  return {
    platform: "instagram",
    async publish(post: Post): Promise<Published> {
      if (!post.media) throw new Error("instagram: a post is an image or a video");
      // The composer takes a file and a caption: a field it can't set fails, never drops.
      const f = fieldsOf("instagram", post.extra);
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
    async list(_q: ListQuery = {}): Promise<PublishedRow[]> {
      throw new Error(NO_READ);
    },
    async metrics(_id: string): Promise<Metrics> {
      throw new Error(NO_READ);
    },
    async comments(_id: string, _q: ListQuery = {}): Promise<CommentRow[]> {
      throw new Error(NO_READ);
    },
  };
}
