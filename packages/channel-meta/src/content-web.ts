/**
 * Instagram through the browser, for the case the Graph API cannot serve:
 * a file on this machine. Publishing on `graph.instagram.com` takes a
 * public URL and a Facebook Page with a professional account linked to
 * it, so without a media host and a Page there is no API path at all —
 * while a signed-in browser posts the file directly. autobrowse answers
 * `POST /web/posts` with its composer flow and guards the account it
 * posts as (`INSTAGRAM_ACCOUNT`), so nothing here knows it is a browser.
 *
 * Reading back is still the API's: the composer has no listing route, so
 * `list`, `metrics` and `comments` want the token and say so plainly.
 */
import type {
  CommentRow,
  ContentChannel,
  ListQuery,
  Metrics,
  Post,
  Published,
  PublishedRow,
  SiteClient,
} from "@wren/core/content";

const NO_READ =
  "instagram: reading posts back needs the API (INSTAGRAM_CLIENT_ID/SECRET, then a consent); the browser leg only publishes";

export function instagramWebContent(
  sites: SiteClient,
  o: { now?: () => Date } = {},
): ContentChannel {
  const now = o.now ?? (() => new Date());
  return {
    platform: "instagram",
    async publish(post: Post): Promise<Published> {
      if (!post.media) throw new Error("instagram: a post is an image or a video");
      const r = await sites.call<{ url?: string | null }>("instagram", "POST", "/web/posts", {
        file: post.media.source,
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
