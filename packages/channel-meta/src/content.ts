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
  type ActivityQuery,
  type ActivityRow,
  type Audience,
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

export interface MetaContentOptions {
  now?: () => Date;
  /** Hosts a local file as a public URL; without it media must already be a URL. */
  host?: MediaHost;
  /** The Page (`me/accounts` lists them); the first Page when absent. */
  pageId?: string;
  /** Between the container and its publish: the Graph API needs a moment for a video. */
  sleep?: (ms: number) => Promise<void>;
}

interface Page {
  id: string;
  name?: string;
  instagram_business_account?: { id: string };
}
interface Edge<T> {
  data?: T[];
}

/** The Page and its Instagram account, read once per channel. */
function pageOf_(sites: SiteClient, o: MetaContentOptions) {
  let page: Promise<Page> | null = null;
  return () => {
    page ??= sites.call<Edge<Page>>("meta", "GET", "/me/accounts", {}).then((r) => {
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
    return page;
  };
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

export function instagramContent(sites: SiteClient, o: MetaContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const page = pageOf_(sites, o);
  const igUser = async () => {
    const p = await page();
    if (!p.instagram_business_account?.id)
      throw new Error(`meta: Page ${p.id} has no Instagram professional account linked`);
    return p.instagram_business_account.id;
  };
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("meta", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const inbox = async () =>
    sites.call<IgInbox>("meta", "GET", `/${await igUser()}`, { fields: IG_INBOX_FIELDS });
  return {
    platform: "instagram",
    async publish(post: Post): Promise<Published> {
      if (!post.media) throw new Error("instagram: a post is an image or a video");
      const f = fieldsOf("instagram", post.extra);
      const ig = await igUser();
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
      if (video) await sleep(15_000);
      const r = await sites.call<{ id?: string }>("meta", "POST", `/${ig}/media_publish`, {
        creation_id: container.id,
      });
      if (!r.id) throw new Error("instagram: publish answered no id");
      return {
        id: r.id,
        url: `https://www.instagram.com/p/${r.id}/`,
        publishedAt: now().toISOString(),
        fetchedWith: await via("POST", "/{igUserId}/media_publish"),
      };
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
      const r = await sites.call<Edge<{ name: string; values?: Array<{ value?: number }> }>>(
        "meta",
        "GET",
        `/${id}/insights`,
        { metric: "reach,likes,comments,shares" },
      );
      const val = (name: string) => r.data?.find((m) => m.name === name)?.values?.[0]?.value ?? 0;
      // Its own call: a Reel refuses `follows`, and that must not cost the rest.
      const follows = await sites
        .call<Edge<{ name: string; values?: Array<{ value?: number }> }>>(
          "meta",
          "GET",
          `/${id}/insights`,
          { metric: "follows" },
        )
        .then((f) => f.data?.find((m) => m.name === "follows")?.values?.[0]?.value ?? null)
        .catch(() => null);
      return {
        id,
        views: val("reach"),
        reactions: val("likes"),
        comments: val("comments"),
        shares: val("shares"),
        follows,
        asOf: now().toISOString(),
        fetchedWith: await via("GET", "/{mediaId}/insights"),
      };
    },
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      const r = await sites.call<
        Edge<{ id: string; text?: string; username?: string; timestamp?: string }>
      >("meta", "GET", `/${id}/comments`, { limit: Math.min(q.limit ?? 100, 100) });
      return pageOf(
        (r.data ?? []).map((c) => ({
          id: c.id,
          postId: id,
          author: c.username ?? "",
          text: c.text ?? "",
          at: c.timestamp ?? now().toISOString(),
        })),
        q,
      );
    },
    async reply(commentId: string, text: string): Promise<void> {
      await sites.call("meta", "POST", `/${commentId}/replies`, { message: text });
    },
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
  };
}

export function facebookContent(sites: SiteClient, o: MetaContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const page = pageOf_(sites, o);
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via("meta", method, path).then((v) => (v === "browser" ? "browser" : "api"));
  const urlOf = (postId: string) => `https://www.facebook.com/${postId}`;
  return {
    platform: "facebook",
    async publish(post: Post): Promise<Published> {
      const { link } = fieldsOf("facebook", post.extra);
      const p = await page();
      let r: { id?: string; post_id?: string };
      let path: string;
      if (!post.media) {
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
      interface PostFields {
        shares?: { count?: number };
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
        insights?: Edge<{ name: string; values?: Array<{ value?: number }> }>;
      }
      const r = await sites.call<PostFields>("meta", "GET", `/${id}`, {
        fields:
          "shares,likes.summary(true),comments.summary(true),insights.metric(post_impressions)",
      });
      return {
        id,
        views:
          r.insights?.data?.find((m) => m.name === "post_impressions")?.values?.[0]?.value ?? 0,
        reactions: r.likes?.summary?.total_count ?? 0,
        comments: r.comments?.summary?.total_count ?? 0,
        shares: r.shares?.count ?? 0,
        asOf: now().toISOString(),
        fetchedWith: await via("GET", "/{objectId}"),
      };
    },
    async comments(): Promise<CommentRow[]> {
      // Page comments need `pages_read_user_content`, not in the app's scopes yet.
      return [];
    },
  };
}
