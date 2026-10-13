/**
 * Threads as a `ContentChannel`, over autobrowse's `threads` site (graph.threads.net, the
 * profile's own long-lived token). A post is two calls: a container (TEXT, or an IMAGE or
 * VIDEO by public URL with the words as its text), then publish. A video container is polled
 * until Threads has fetched it. Replies under a post are its comments; a reply is a container
 * with `reply_to_id`. Links ride as a card (`link_attachment`) on a text post.
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

export interface ThreadsContentOptions {
  now?: () => Date;
  /** Hosts a local file as a public URL; without it media must already be a URL. */
  host?: MediaHost;
  sleep?: (ms: number) => Promise<void>;
}

const SITE = "threads";
/** A video container is ready within a few minutes; past this the post fails unposted. */
const VIDEO_POLLS = 30;
const VIDEO_POLL_MS = 10_000;

interface Edge<T> {
  data?: T[];
}
interface Insight {
  name: string;
  values?: Array<{ value?: number }>;
  total_value?: { value?: number };
}

export function threadsContent(sites: SiteClient, o: ThreadsContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via(SITE, method, path).then((v) => (v === "browser" ? "browser" : "api"));

  /** Waits out a video container: FINISHED goes on, ERROR or EXPIRED stops with Threads' words. */
  async function ready(id: string): Promise<void> {
    for (let n = 0; n < VIDEO_POLLS; n++) {
      await sleep(VIDEO_POLL_MS);
      const c = await sites.call<{ status?: string; error_message?: string }>(
        SITE,
        "GET",
        `/containers/${id}`,
      );
      if (c.status === "FINISHED" || c.status === "PUBLISHED") return;
      if (c.status === "ERROR" || c.status === "EXPIRED")
        throw new Error(`threads: the video was refused (${c.error_message ?? c.status})`);
    }
    throw new Error("threads: the video was still processing after 5 minutes");
  }

  /** Container then publish; answers the post's id. */
  async function post(body: Record<string, unknown>, video: boolean): Promise<string> {
    const c = await sites.call<{ id?: string }>(SITE, "POST", "/me/threads", body);
    if (!c.id) throw new Error("threads: the container answered no id");
    if (video) await ready(c.id);
    const r = await sites.call<{ id?: string }>(SITE, "POST", "/me/threads_publish", {
      creation_id: c.id,
    });
    if (!r.id) throw new Error("threads: publish answered no id");
    return r.id;
  }

  const permalink = (id: string) =>
    sites
      .call<{ permalink?: string }>(SITE, "GET", `/posts/${id}`, { fields: "permalink" })
      .then((m) => m.permalink ?? null)
      .catch(() => null);

  return {
    platform: "threads",
    async publish(p: Post): Promise<Published> {
      const f = fieldsOf("threads", p.extra);
      const media = p.media;
      const video = media?.kind === "video";
      const body: Record<string, unknown> = {
        text: p.text,
        ...(f.replyControl ? { reply_control: f.replyControl } : {}),
      };
      if (media) {
        const url = await publicUrlOf(media.source, o.host, "threads");
        Object.assign(
          body,
          video ? { media_type: "VIDEO", video_url: url } : { media_type: "IMAGE", image_url: url },
        );
      } else {
        body.media_type = "TEXT";
        if (f.linkCard) body.link_attachment = f.linkCard;
      }
      const id = await post(body, video);
      // The link names the profile and a short code: read it back, never fail the post over it.
      const url = (await permalink(id)) ?? "https://www.threads.com/";
      return {
        id,
        url,
        publishedAt: now().toISOString(),
        fetchedWith: await via("POST", "/{userId}/threads_publish"),
      };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const r = await sites.call<
        Edge<{ id: string; text?: string; permalink?: string; timestamp?: string }>
      >(SITE, "GET", "/me/threads", {
        fields: "id,text,permalink,timestamp",
        limit: Math.min(q.limit ?? 100, 100),
      });
      const fetchedWith = await via("GET", "/{userId}/threads");
      return pageOf(
        (r.data ?? []).map((m) => ({
          id: m.id,
          url: m.permalink ?? "https://www.threads.com/",
          publishedAt: m.timestamp ?? now().toISOString(),
          fetchedWith,
          preview: previewOf(m.text ?? ""),
        })),
        q,
      );
    },
    async metrics(id: string): Promise<Metrics> {
      const r = await sites.call<Edge<Insight>>(SITE, "GET", `/${id}/insights`, {
        metric: "views,likes,replies,reposts,quotes,shares",
      });
      const val = (name: string) => {
        const m = r.data?.find((x) => x.name === name);
        return m?.total_value?.value ?? m?.values?.[0]?.value ?? 0;
      };
      return {
        id,
        views: val("views"),
        reactions: val("likes"),
        comments: val("replies"),
        shares: val("reposts") + val("quotes") + val("shares"),
        asOf: now().toISOString(),
        fetchedWith: await via("GET", "/{mediaId}/insights"),
      };
    },
    async comments(id: string, q: ListQuery = {}): Promise<CommentRow[]> {
      const r = await sites.call<
        Edge<{
          id: string;
          text?: string;
          username?: string;
          timestamp?: string;
          permalink?: string;
        }>
      >(SITE, "GET", `/${id}/replies`, {
        fields: "id,text,username,permalink,timestamp",
      });
      return pageOf(
        (r.data ?? []).map((c) => ({
          id: c.id,
          postId: id,
          author: c.username ?? "",
          text: c.text ?? "",
          at: c.timestamp ?? now().toISOString(),
          ...(c.permalink ? { url: c.permalink } : {}),
        })),
        q,
      );
    },
    async reply(commentId: string, text: string): Promise<void> {
      await post({ media_type: "TEXT", text, reply_to_id: commentId }, false);
    },
  };
}
