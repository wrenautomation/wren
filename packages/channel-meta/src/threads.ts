/**
 * Threads as a `ContentChannel`, over autobrowse's `threads` site (graph.threads.net, the
 * profile's own long-lived token). A post is two calls: a container (TEXT, or an IMAGE or
 * VIDEO by public URL with the words as its text), then publish. A video container is polled
 * until Threads has fetched it. Replies under a post are its comments; a reply is a container
 * with `reply_to_id`. Links ride as a card (`link_attachment`) on a text post.
 */
import {
  type AccountInsights,
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
  pageFollowing,
  pageOf,
  previewOf,
  publicUrlOf,
  readGroup,
  type SiteClient,
} from "@wren/core/content";
import { fieldsOf } from "@wren/core/content/shapes";
import { igFollowersOf } from "./content.js";
import { VIDEO_WAITS_MS } from "./poll.js";

/** Status reads of a words or image container before its publish: 1 minute in all. */
const WORDS_WAITS_MS: readonly number[] = [2_000, 3_000, 5_000, 10_000, 10_000, 30_000];

export interface ThreadsContentOptions {
  now?: () => Date;
  /** Hosts a local file as a public URL; without it media must already be a URL. */
  host?: MediaHost;
  sleep?: (ms: number) => Promise<void>;
}

const SITE = "threads";

interface Edge<T> {
  data?: T[];
}
interface Insight {
  name: string;
  values?: Array<{ value?: number }>;
  total_value?: {
    value?: number;
    breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }>;
  };
  /** `clicks` comes as one count per link (seen live 2026-10-23). */
  link_total_values?: Array<{ value?: number; link_url?: string }>;
}
/**
 * One number per metric. A day series gives its last day: Threads cuts days at Pacific midnight,
 * so a UTC day's range returns two, and the last is the whole day before today. Clicks sum
 * their links.
 */
const val = (r: Edge<Insight>, name: string) => {
  const m = r.data?.find((x) => x.name === name);
  if (m?.link_total_values) return m.link_total_values.reduce((a, v) => a + (v.value ?? 0), 0);
  return m?.total_value?.value ?? m?.values?.at(-1)?.value;
};
/** Threads gives follower demographics from 100 followers; under that it answers 400. */
const DEMOGRAPHICS_FROM = 100;
/** A post's numbers: Threads has no watch time or reach for a post, video or not. */
const POST = "views,likes,replies,reposts,quotes,shares,clicks";
/** The profile's day: `views` comes as days, the rest as totals over the range. */
const PROFILE: Record<string, string> = {
  views: M.views,
  likes: M.likes,
  replies: M.comments,
  clicks: M.linkClicks,
  followers_count: M.followers,
};
const FOLLOWERS: ReadonlyArray<["country" | "city" | "age" | "gender", string]> = [
  ["country", M.viewerCountry],
  ["age", M.viewerAge],
  ["gender", M.viewerGender],
];
const FEW = "Threads shows the followers' make-up once the profile has 100 followers";

export function threadsContent(sites: SiteClient, o: ThreadsContentOptions = {}): ContentChannel {
  const now = o.now ?? (() => new Date());
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const via = (method: "GET" | "POST", path: string): Promise<FetchedWith> =>
    sites.via(SITE, method, path).then((v) => (v === "browser" ? "browser" : "api"));

  /** Waits out a container: FINISHED goes on, ERROR or EXPIRED stops with Threads' words. */
  async function ready(id: string, video: boolean): Promise<void> {
    for (const wait of video ? VIDEO_WAITS_MS : WORDS_WAITS_MS) {
      await sleep(wait);
      const c = await sites.call<{ status?: string; error_message?: string }>(
        SITE,
        "GET",
        `/containers/${id}`,
      );
      if (c.status === "FINISHED" || c.status === "PUBLISHED") return;
      if (c.status === "ERROR" || c.status === "EXPIRED")
        throw new Error(`threads: the video was refused (${c.error_message ?? c.status})`);
    }
    throw new Error(`threads: the ${video ? "video" : "post"} was still processing`);
  }

  /** Container then publish; answers the post's id. */
  async function post(body: Record<string, unknown>, video: boolean): Promise<string> {
    const c = await sites.call<{ id?: string }>(SITE, "POST", "/me/threads", body);
    if (!c.id) throw new Error("threads: the container answered no id");
    // A publish right after the container answers 400: Threads is still making it, even for words.
    await ready(c.id, video);
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
    // The Threads profile's Following tab, through Instagram's sign-in (the API lists no follows).
    following: () =>
      pageFollowing(
        sites,
        "instagram",
        "/web/threads/following",
        (h) => `https://www.threads.com/@${h}`,
      ),
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
          ...(m.text ? { text: m.text } : {}),
        })),
        q,
      );
    },
    async metrics(id: string): Promise<Metrics> {
      const r = await sites.call<Edge<Insight>>(SITE, "GET", `/${id}/insights`, {
        metric: "views,likes,replies,reposts,quotes,shares",
      });
      const n = (name: string) => val(r, name) ?? 0;
      return {
        id,
        views: n("views"),
        reactions: n("likes"),
        comments: n("replies"),
        shares: n("reposts") + n("quotes") + n("shares"),
        asOf: now().toISOString(),
        fetchedWith: await via("GET", "/{mediaId}/insights"),
      };
    },
    async insights(q: InsightsQuery): Promise<Insights> {
      const out: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      await readGroup(
        [M.views, M.likes, M.comments, M.shares, M.linkClicks],
        async () => {
          const r = await sites.call<Edge<Insight>>(SITE, "GET", `/${q.id}/insights`, {
            metric: POST,
          });
          const n = (name: string) => val(r, name);
          const shared = [n("reposts"), n("quotes"), n("shares")];
          return [
            ...numberOf(M.views, n("views")),
            ...numberOf(M.likes, n("likes")),
            ...numberOf(M.comments, n("replies")),
            ...(shared.some((x) => x !== undefined)
              ? numberOf(
                  M.shares,
                  shared.reduce<number>((a, x) => a + (x ?? 0), 0),
                )
              : []),
            ...numberOf(M.linkClicks, n("clicks")),
          ];
        },
        out,
      );
      return { ...out, asOf: now().toISOString() };
    },
    async accountInsights(): Promise<AccountInsights> {
      const out: { values: InsightValue[]; gaps: InsightGap[] } = { values: [], gaps: [] };
      // Yesterday, whole: today's numbers are still moving.
      const until = new Date(`${now().toISOString().slice(0, 10)}T00:00:00Z`);
      const since = new Date(until.getTime() - 86_400_000);
      const sec = (d: Date) => Math.floor(d.getTime() / 1000);
      let followers: number | null = null;
      await readGroup(
        Object.values(PROFILE),
        async () => {
          const r = await sites.call<Edge<Insight>>(SITE, "GET", "/me/threads_insights", {
            metric: Object.keys(PROFILE).join(","),
            since: sec(since),
            until: sec(until),
          });
          followers = val(r, "followers_count") ?? null;
          return Object.entries(PROFILE).flatMap(([theirs, ours]) =>
            numberOf(ours, val(r, theirs)),
          );
        },
        out,
      );
      const few: string[] = [];
      for (const [breakdown, metric] of FOLLOWERS)
        if (followers !== null && followers < DEMOGRAPHICS_FROM) few.push(metric);
        else
          await readGroup(
            [metric],
            async () => {
              const r = await sites.call<Edge<Insight>>(SITE, "GET", "/me/threads_insights", {
                metric: "follower_demographics",
                breakdown,
              });
              const got = igFollowersOf(
                metric,
                r.data?.find((d) => d.name === "follower_demographics"),
              );
              if (!got.length) few.push(metric);
              return got;
            },
            out,
          );
      out.gaps.push(...knownGaps("waiting", FEW, few));
      return {
        days: out.values.length
          ? [{ day: since.toISOString().slice(0, 10), values: out.values }]
          : [],
        gaps: out.gaps,
        asOf: now().toISOString(),
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
