/**
 * LinkedIn as a `ContentChannel`, over autobrowse's site API in LinkedIn's
 * own shape (Posts API, Social Actions). Whether a call is answered by the
 * API or a browser flow is the worker's business; rows say which.
 */
import {
  type CommentRow,
  type ContentChannel,
  type FetchedWith,
  type ListQuery,
  type Metrics,
  type Post,
  type Published,
  type PublishedRow,
  pageOf,
  previewOf,
  type SiteClient,
} from "@wren/core/content";

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
      const body: Record<string, unknown> = {
        author: await me(),
        commentary: post.text,
        visibility: (post.extra?.visibility as string | undefined) ?? "PUBLIC",
        lifecycleState: "PUBLISHED",
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
  };
}
