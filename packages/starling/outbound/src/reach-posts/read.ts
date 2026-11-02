/** The platform reads: each site's posts as one `FeedPost` shape, through autobrowse as the account. */

import { capWaitMs, type SiteClient } from "@wren/core/content";
import type { ReachPostPlatform } from "../schema.js";

/**
 * Results one search scrolls to, the flow's most. A platform counts searches and page loads, not
 * results, so one deep search beats several short ones (William 10-25: most data per action).
 */
const SEARCH_MAX = {
  linkedin: 50,
  x: 100,
  instagram: 30,
  youtube: 50,
  tiktok: 30,
  threads: 30,
} as const;

/** Words a search leaves out (LinkedIn `NOT`, X `-`): job ads drown the owners' own posts. */
const JOB_WORDS = ["hiring", "jobs", "vacancy"] as const;
/** Posts opened off one Instagram search, newest first: each is a page load. */
const IG_POSTS_PER_SEARCH = 6;

/** A post as the readers give it: autobrowse's `FeedPost` on LinkedIn, mapped on X and Instagram. */
export interface FeedPost {
  /** What the platform's routes take: LinkedIn's urn, X's post id, Instagram's shortcode. */
  ref: string;
  author: string;
  authorUrl: string | null;
  /** The author's handle (X or Instagram username, LinkedIn vanity), lowercased. */
  handle?: string | null;
  headline?: string;
  text: string;
  age?: string;
  at?: string;
  approx?: true;
  reactions: number;
  comments: number;
  url: string;
  /** Off target as the reader sees it (a gaming video, not in English): kept as dropped with this. */
  off?: string;
  raw?: unknown;
}

export type Since = "past-24h" | "past-week" | "past-month";

export interface KeyPerson {
  handle: string;
  name: string;
}

export interface PostReader {
  search(keywords: string, since: Since): Promise<FeedPost[]>;
  /** A page's recent posts: a LinkedIn company, an X or Instagram account. */
  page(handle: string): Promise<FeedPost[]>;
  /** What a key person wrote lately. */
  person(k: KeyPerson, since: Since): Promise<FeedPost[]>;
  /** One post by its ref, pasted; null when it is gone. */
  one(ref: string): Promise<FeedPost | null>;
  /** The account's home feed, one load scrolled deep: posts by the people it follows. */
  feed(): Promise<FeedPost[]>;
}

/** Posts one feed load reads (each autobrowse feed route's most). */
const FEED_MAX = 50;

const SINCE_DAYS: Readonly<Record<Since, number>> = {
  "past-24h": 1,
  "past-week": 7,
  "past-month": 30,
};

/** autobrowse's LinkedIn post (`GET /search/results/content`, `GET /company/{c}/posts`). */
interface LinkedinFeedPost extends Omit<FeedPost, "ref" | "handle"> {
  urn: string;
}
/** autobrowse's X post off the page (`x-read.ts`'s `Tweet`). */
interface XTweet {
  id: string;
  text: string;
  author_username: string;
  author_name?: string;
  created_at?: string;
  public_metrics?: { reply_count?: number; retweet_count?: number; like_count?: number };
  pinned?: true;
  reposted_by?: string;
}
/** A post page's tags (autobrowse `instagram GET /web/p/{shortcode}`). */
interface IgPost {
  shortcode: string;
  url: string;
  username: string | null;
  caption: string;
  likes: number | null;
  comments: number | null;
  timestamp: string | null;
}
/** Graph's `business_discovery` media (autobrowse `meta GET /instagram/{username}`). */
interface IgMedia {
  caption?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

/** A YouTube Data API video (`videos?part=snippet,statistics`). */
export interface YtVideo {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    categoryId?: string;
    defaultAudioLanguage?: string;
  };
  /** `commentCount` is absent when the video takes no comments. */
  statistics?: { likeCount?: string; commentCount?: string };
}

/** YouTube categories no owner talks shop in: their "founder" is a news story, a game, a show. */
const YT_OFF_CATEGORY: Record<string, string> = {
  "1": "a film",
  "2": "a car video",
  "10": "a music video",
  "15": "a pet video",
  "17": "a sports video",
  "19": "a travel video",
  "20": "a gaming video",
  "23": "a comedy video",
  "24": "an entertainment video",
  "25": "a news video",
};

/** A video as a post; the channel id is its handle, case kept (an id lowercased is another). */
export const ytPostOf = (v: YtVideo): FeedPost | null => {
  const sn = v.snippet;
  if (!sn?.channelId || v.statistics?.commentCount === undefined) return null;
  const lang = sn.defaultAudioLanguage;
  const off =
    (sn.categoryId && YT_OFF_CATEGORY[sn.categoryId]) ||
    (lang && !/^en\b/i.test(lang) ? "not in English" : undefined);
  return {
    ...(off ? { off } : {}),
    ref: v.id,
    author: sn.channelTitle || sn.channelId,
    authorUrl: `https://www.youtube.com/channel/${sn.channelId}`,
    handle: sn.channelId,
    text: [sn.title, sn.description].filter(Boolean).join("\n\n"),
    ...(sn.publishedAt ? { at: sn.publishedAt } : {}),
    reactions: Number(v.statistics.likeCount ?? 0),
    comments: Number(v.statistics.commentCount),
    url: `https://www.youtube.com/watch?v=${v.id}`,
    raw: v,
  };
};

/** autobrowse's TikTok search row (`tiktok GET /web/search`). */
interface TtVideo {
  id: string;
  url: string;
  username: string;
  name: string | null;
  bio: string | null;
  text: string;
  at: string;
  likes: number | null;
  comments: number | null;
}

const ttPostOf = (v: TtVideo): FeedPost => ({
  ref: v.id,
  author: v.name || v.username,
  authorUrl: `https://www.tiktok.com/@${v.username}`,
  handle: v.username.toLowerCase(),
  ...(v.bio ? { headline: v.bio } : {}),
  text: v.text,
  ...(v.at ? { at: v.at } : {}),
  reactions: v.likes ?? 0,
  comments: v.comments ?? 0,
  url: v.url,
  raw: v,
});

/** autobrowse's Threads search row (`instagram GET /web/threads/search`). */
interface ThPost {
  code: string;
  url: string;
  username: string;
  text: string;
  at: string;
  likes: number | null;
  replies: number | null;
}

const thPostOf = (p: ThPost): FeedPost => ({
  ref: p.code,
  author: p.username,
  authorUrl: `https://www.threads.com/@${p.username}`,
  handle: p.username.toLowerCase(),
  text: p.text,
  ...(p.at ? { at: p.at } : {}),
  reactions: p.likes ?? 0,
  comments: p.replies ?? 0,
  url: p.url,
  raw: p,
});

/** autobrowse's `GET /rest/posts/{urn}`: the API's post, or its page in that shape until granted. */
interface RestPost {
  id: string;
  commentary?: string;
  publishedAt?: number;
  authorName?: string;
  authorUrl?: string | null;
  headline?: string;
  reactions?: number;
  comments?: number;
  url?: string;
}

const fromRestPost = (p: RestPost): FeedPost => ({
  ref: p.id,
  author: p.authorName ?? "",
  authorUrl: p.authorUrl ?? null,
  handle: vanityOf(p.authorUrl),
  ...(p.headline ? { headline: p.headline } : {}),
  text: p.commentary ?? "",
  ...(p.publishedAt ? { at: new Date(p.publishedAt).toISOString() } : {}),
  reactions: p.reactions ?? 0,
  comments: p.comments ?? 0,
  url: p.url ?? `https://www.linkedin.com/feed/update/${p.id}/`,
});

/** A name to search from a LinkedIn link: "jane-doe-4b1a2" reads "jane doe". */
export const nameOfVanity = (vanity: string) =>
  vanity
    .split("-")
    .filter((w) => !/\d/.test(w))
    .join(" ");

const fromLinkedin = (p: LinkedinFeedPost): FeedPost => {
  const { urn, ...rest } = p;
  return { ...rest, ref: urn, handle: vanityOf(p.authorUrl) };
};

const xPostOf = (t: XTweet): FeedPost => {
  const u = t.author_username;
  const m = t.public_metrics ?? {};
  return {
    ref: t.id,
    author: t.author_name || u,
    authorUrl: `https://x.com/${u}`,
    handle: u.toLowerCase(),
    text: t.text,
    ...(t.created_at ? { at: t.created_at } : {}),
    reactions: (m.like_count ?? 0) + (m.retweet_count ?? 0),
    comments: m.reply_count ?? 0,
    url: `https://x.com/${u}/status/${t.id}`,
    raw: t,
  };
};

const igPostOf = (p: IgPost, bio?: string): FeedPost | null =>
  p.username
    ? {
        ref: p.shortcode,
        author: p.username,
        authorUrl: `https://www.instagram.com/${p.username}/`,
        handle: p.username.toLowerCase(),
        ...(bio ? { headline: bio } : {}),
        text: p.caption,
        ...(p.timestamp ? { at: p.timestamp } : {}),
        reactions: p.likes ?? 0,
        comments: p.comments ?? 0,
        url: p.url,
        raw: p,
      }
    : null;

/** When an Instagram post was made, from its shortcode alone (the media id's high bits). */
export function shortcodeAt(code: string): Date | null {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let id = 0n;
  for (const ch of code) {
    const i = A.indexOf(ch);
    if (i < 0) return null;
    id = id * 64n + BigInt(i);
  }
  const at = new Date(Number(id >> 23n) + 1_314_220_021_721);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * A search's words as the platform reads them: plain words with a space become one quoted phrase
 * ("recruitment agency", not recruitment anywhere and agency anywhere). Quotes or operators stay.
 */
export function phrase(keywords: string): string {
  const t = keywords.trim();
  return /["()]|\b(?:OR|AND|NOT)\b|(?:^|\s)[-#@]/.test(t) || !t.includes(" ") ? t : `"${t}"`;
}

/** The shortcode in an Instagram permalink (`/p/<code>/`, `/reel/<code>/`). */
const shortcodeOf = (url: string | undefined) =>
  url ? (/instagram\.com\/(?:[\w.]+\/)?(?:p|reel|tv)\/([\w-]+)/.exec(url)?.[1] ?? null) : null;

/** The platform's reads as `account`. */
export function postReader(
  sites: SiteClient,
  platform: ReachPostPlatform,
  account: string,
  o: { authorTitle?: string; now: Date },
): PostReader {
  if (platform === "linkedin") {
    type Out = { posts?: LinkedinFeedPost[] };
    // Their name as a search; only what they wrote is kept.
    const person = async (k: KeyPerson, since: Since) =>
      (
        (
          await sites.call<Out>(
            "linkedin",
            "GET",
            "/search/results/content",
            { keywords: k.name, max: 20, since },
            account,
          )
        ).posts ?? []
      )
        .map(fromLinkedin)
        .filter((p) => p.handle === k.handle);
    const search = async (keywords: string, since: Since) =>
      (
        (
          await sites.call<Out>(
            "linkedin",
            "GET",
            "/search/results/content",
            {
              keywords: `${phrase(keywords)} ${JOB_WORDS.map((w) => `NOT ${w}`).join(" ")}`,
              max: SEARCH_MAX.linkedin,
              since,
              ...(o.authorTitle ? { authorTitle: o.authorTitle } : {}),
            },
            account,
          )
        ).posts ?? []
      ).map(fromLinkedin);
    return {
      search,
      // A person he follows (`in/<vanity>`) is read like a key person, by the name in their link.
      page: async (handle) =>
        handle.startsWith("in/")
          ? person({ handle: handle.slice(3), name: nameOfVanity(handle.slice(3)) }, "past-week")
          : (
              (
                await sites.call<Out>(
                  "linkedin",
                  "GET",
                  `/company/${encodeURIComponent(handle)}/posts`,
                  { company: handle, max: 20 },
                  account,
                )
              ).posts ?? []
            ).map(fromLinkedin),
      person,
      one: async (urn) => {
        const p = await sites.call<RestPost | { found: false }>(
          "linkedin",
          "GET",
          `/rest/posts/${encodeURIComponent(urn)}`,
          { urn },
          account,
        );
        return "found" in p ? null : fromRestPost(p);
      },
      feed: async () =>
        (
          (await sites.call<Out>("linkedin", "GET", "/feed", { max: FEED_MAX }, account)).posts ??
          []
        ).map(fromLinkedin),
    };
  }
  if (platform === "x") {
    type Out = { data?: XTweet[] };
    const own = (ts: XTweet[] | undefined) =>
      (ts ?? []).filter((t) => !t.reposted_by && !t.pinned).map(xPostOf);
    const page = async (handle: string) =>
      own(
        (
          await sites.call<Out>(
            "x",
            "GET",
            `/2/users/${encodeURIComponent(handle)}/tweets`,
            { id: handle, max_results: 20, exclude: "retweets,replies" },
            account,
          )
        ).data,
      );
    return {
      // X's own search words: original posts in English since the day the window opens.
      search: async (keywords, since) => {
        const day = new Date(o.now.getTime() - SINCE_DAYS[since] * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const query = `${phrase(keywords)} ${JOB_WORDS.map((w) => `-${w}`).join(" ")} lang:en -filter:replies -filter:retweets since:${day}`;
        return own(
          (
            await sites.call<Out>(
              "x",
              "GET",
              "/2/tweets/search/recent",
              { query, max_results: SEARCH_MAX.x },
              account,
            )
          ).data,
        );
      },
      page,
      person: (k) => page(k.handle),
      one: async (id) => {
        const r = await sites.call<{ data?: XTweet }>(
          "x",
          "GET",
          `/2/tweets/${encodeURIComponent(id)}`,
          { id },
          account,
        );
        return r.data ? xPostOf(r.data) : null;
      },
      // The browser leg reads the signed-in account's Following tab, whatever the id.
      feed: async () =>
        own(
          (
            await sites.call<Out>(
              "x",
              "GET",
              "/2/users/me/timelines/reverse_chronological",
              { id: "me", max_results: FEED_MAX },
              account,
            )
          ).data,
        ),
    };
  }
  if (platform === "youtube") {
    // A search names videos (100 units); one `videos` read (1 unit) gives their text and counts.
    const videos = async (ids: string[]) =>
      ids.length
        ? (
            (
              await sites.call<{ items?: YtVideo[] }>(
                "youtube",
                "GET",
                "/youtube/v3/videos",
                {
                  resource: "videos",
                  part: "snippet,statistics",
                  id: ids.join(","),
                  maxResults: 50,
                },
                account,
              )
            ).items ?? []
          ).flatMap((v) => ytPostOf(v) ?? [])
        : [];
    const found = async (q: Record<string, unknown>) =>
      videos(
        (
          (
            await sites.call<{ items?: Array<{ id?: { videoId?: string } }> }>(
              "youtube",
              "GET",
              "/youtube/v3/search",
              { resource: "search", part: "snippet", type: "video", order: "date", ...q },
              account,
            )
          ).items ?? []
        ).flatMap((i) => (i.id?.videoId ? [i.id.videoId] : [])),
      );
    const page = (channelId: string) => found({ channelId, maxResults: 10 });
    return {
      search: (keywords, since) =>
        found({
          q: `${phrase(keywords)} ${JOB_WORDS.map((w) => `-${w}`).join(" ")}`,
          maxResults: SEARCH_MAX.youtube,
          relevanceLanguage: "en",
          publishedAfter: new Date(o.now.getTime() - SINCE_DAYS[since] * 86_400_000).toISOString(),
        }),
      page,
      person: (k) => page(k.handle),
      one: async (id) => (await videos([id]))[0] ?? null,
      // Subscriptions have no cheap feed read: a search a channel would spend the day's quota.
      feed: async () => [],
    };
  }
  if (platform === "tiktok" || platform === "threads") {
    // Search only, by page load: no account page or feed read is built, and one post is found
    // by its search again, never alone.
    const search =
      platform === "tiktok"
        ? async (keywords: string) =>
            (
              (
                await sites.call<{ data?: TtVideo[] }>(
                  "tiktok",
                  "GET",
                  "/web/search",
                  { q: keywords, max: SEARCH_MAX.tiktok },
                  account,
                )
              ).data ?? []
            ).map(ttPostOf)
        : async (keywords: string) =>
            (
              (
                await sites.call<{ data?: ThPost[] }>(
                  "instagram",
                  "GET",
                  "/web/threads/search",
                  { q: keywords, max: SEARCH_MAX.threads },
                  account,
                )
              ).data ?? []
            ).map(thPostOf);
    return {
      search,
      page: async () => [],
      person: async () => [],
      one: async () => null,
      feed: async () => [],
    };
  }
  if (platform !== "instagram") throw new Error(`no ${platform} reader`);
  type Found = { found?: boolean; profile?: { biography?: string }; media?: IgMedia[] };
  const page = async (handle: string) => {
    // Graph's business discovery, on Wren's Facebook Login token: no page load.
    const r = await sites.call<Found>("meta", "GET", `/instagram/${encodeURIComponent(handle)}`, {
      username: handle,
    });
    if (!r.found) return [];
    const bio = r.profile?.biography;
    return (r.media ?? []).flatMap((m) => {
      const code = shortcodeOf(m.permalink);
      const post =
        code && m.permalink
          ? igPostOf(
              {
                shortcode: code,
                url: m.permalink,
                username: handle,
                caption: m.caption ?? "",
                likes: m.like_count ?? null,
                comments: m.comments_count ?? null,
                timestamp: m.timestamp ?? null,
              },
              bio,
            )
          : null;
      return post ? [post] : [];
    });
  };
  return {
    // Instagram's search gives a grid of codes (one load); each post is a page of its own, so
    // the newest open first. Its top posts run months old: those still name accounts in the
    // trade, which Graph then reads fresh (`keyPeople`).
    search: async (keywords) => {
      const found = await sites.call<{ shortcodes?: string[] }>(
        "instagram",
        "GET",
        "/web/search",
        { q: keywords, max: SEARCH_MAX.instagram },
        account,
      );
      const at = (c: string) => shortcodeAt(c)?.getTime() ?? 0;
      const codes = [...(found.shortcodes ?? [])]
        .sort((a, b) => at(b) - at(a))
        .slice(0, IG_POSTS_PER_SEARCH);
      const out: FeedPost[] = [];
      // A page that fails costs only itself; a used cap ends the search, and so do all failing.
      let failed: unknown = null;
      for (const code of codes) {
        try {
          const p = await sites.call<IgPost & { found?: false }>(
            "instagram",
            "GET",
            `/web/p/${encodeURIComponent(code)}`,
            { shortcode: code },
            account,
          );
          const post = p.found === false ? null : igPostOf(p);
          if (post) out.push(post);
        } catch (err) {
          if (capWaitMs(err) !== null) throw err;
          failed = err;
        }
      }
      if (!out.length && failed) throw failed;
      return out;
    },
    page,
    person: (k) => page(k.handle),
    one: async (code) => {
      const p = await sites.call<IgPost & { found?: false }>(
        "instagram",
        "GET",
        `/web/p/${encodeURIComponent(code)}`,
        { shortcode: code },
        account,
      );
      return p.found === false ? null : igPostOf(p);
    },
    feed: async () =>
      (
        (
          await sites.call<{ data?: IgPost[] }>(
            "instagram",
            "GET",
            "/web/feed",
            { max: FEED_MAX },
            account,
          )
        ).data ?? []
      ).flatMap((p) => igPostOf(p) ?? []),
  };
}

/** Decoded like touches keys it: a non-Latin slug percent-encoded outgrows the column (2026-10-11). */
export const vanityOf = (url: string | null | undefined) => {
  const slug = url ? /linkedin\.com\/(?:in|company)\/([^/?#]+)/i.exec(url)?.[1] : undefined;
  if (!slug) return null;
  let v = slug;
  try {
    v = decodeURIComponent(slug);
  } catch {}
  v = v.toLowerCase();
  return v.length <= 120 ? v : null;
};
