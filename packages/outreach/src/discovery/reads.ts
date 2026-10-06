/**
 * Reddit read signed out: every call goes to autobrowse's `reddit-public` site, never to one of
 * our accounts (designs/2026-10-06-reddit-discovery.md, Read identity). The desk paces and caps
 * them (one every 6 to 9 seconds, 400 a day).
 */
import { type Listing, REDDIT_SITE, redditOutreach, type Thing } from "@wren/channel-reddit";
import type { SiteClient } from "@wren/core/content";
import type { Profile } from "@wren/core/outreach";

export const PUBLIC_SITE = "reddit-public";

/** The same client, with every `reddit` call sent to the signed-out site. */
export const signedOut = (sites: SiteClient): SiteClient => {
  const to = (site: string) => (site === REDDIT_SITE ? PUBLIC_SITE : site);
  return {
    call: (site, method, path, input) => sites.call(to(site), method, path, input),
    via: (site, method, path) => sites.via(to(site), method, path),
  };
};

export type Post = Thing & {
  subreddit?: string;
  url?: string;
  over_18?: boolean;
  locked?: boolean;
  archived?: boolean;
  stickied?: boolean;
  removed_by_category?: string | null;
  link_flair_text?: string | null;
};

export interface SubredditAbout {
  display_name?: string;
  title?: string;
  public_description?: string;
  description?: string;
  subscribers?: number;
  active_user_count?: number;
  subreddit_type?: string;
  over18?: boolean;
  submission_type?: string;
}

export const itemsOf = <T>(l: Listing | undefined): T[] =>
  ((l?.data?.children ?? []) as unknown as Array<{ data: T }>).map((c) => c.data);

const dataOf = <T>(x: { data?: T } | T): T =>
  (x && typeof x === "object" && "data" in x && x.data ? x.data : x) as T;

export interface PlaceRead {
  about: SubredditAbout;
  rules: unknown;
  top: Post[];
  latest: Post[];
}

export interface Reader {
  person(handle: string): Promise<Profile>;
  /** Subreddit names for a topic, most subscribed first. */
  searchPlaces(topic: string): Promise<{ name: string; subscribers: number }[]>;
  /** Subreddit names in the reddit.com results of an Exa search for a topic. */
  exaPlaces(topic: string): Promise<string[]>;
  place(sub: string): Promise<PlaceRead>;
  latest(sub: string): Promise<Post[]>;
  /** The post and every comment under it, flattened, top-level first. */
  thread(id: string): Promise<{ post: Post; comments: (Thing & { depth: number })[] }>;
  /** Things by fullname (our comments, for their score). */
  info(ids: string[]): Promise<Thing[]>;
}

const SUB_URL = /^https?:\/\/(?:[a-z]+\.)?reddit\.com\/r\/([A-Za-z0-9_]{2,21})(?:[/?#]|$)/i;

/** Subreddit names in result URLs (reddit.com/r/<name>/...), lowercase, once each. */
export const subredditsIn = (urls: readonly string[]): string[] => [
  ...new Set(urls.flatMap((u) => SUB_URL.exec(u)?.[1]?.toLowerCase() ?? [])),
];

export function reader(sites: SiteClient): Reader {
  const out = signedOut(sites);
  const call = <T>(path: string, input: Record<string, unknown> = {}) =>
    out.call<T>(REDDIT_SITE, "GET", path, { raw_json: 1, ...input });
  const asPeople = redditOutreach(out, { account: PUBLIC_SITE });
  return {
    person: (handle) => asPeople.enrich(handle),
    async searchPlaces(topic) {
      const l = await call<Listing>("/subreddits/search", { q: topic, limit: 10 });
      return itemsOf<SubredditAbout>(l).flatMap((s) =>
        s.display_name && s.subreddit_type === "public" && !s.over18
          ? [{ name: s.display_name, subscribers: s.subscribers ?? 0 }]
          : [],
      );
    },
    // autobrowse's `web /search` with Exa only: its key ring, a spent ring answers 402.
    // ponytail: Exa gets no includeDomains here, so `site:` is a hint and the URLs are filtered.
    async exaPlaces(topic) {
      const r = await out.call<{ hits?: { url: string }[] }>("web", "GET", "/search", {
        q: `site:reddit.com ${topic}`,
        n: 10,
        via: "exa",
      });
      return subredditsIn((r.hits ?? []).map((h) => h.url));
    },
    async place(sub) {
      const about = dataOf(await call<{ data?: SubredditAbout }>(`/r/${sub}/about`));
      const rules = await call<unknown>(`/r/${sub}/about/rules`);
      const top = itemsOf<Post>(await call<Listing>(`/r/${sub}/top`, { t: "week", limit: 25 }));
      const latest = itemsOf<Post>(await call<Listing>(`/r/${sub}/new`, { limit: 25 }));
      return { about, rules, top, latest };
    },
    latest: async (sub) => itemsOf<Post>(await call<Listing>(`/r/${sub}/new`, { limit: 50 })),
    async thread(id) {
      const [head, tree] = await call<[Listing, Listing]>(`/comments/${id.replace(/^t3_/, "")}`, {
        limit: 200,
      });
      const comments: (Thing & { depth: number })[] = [];
      const walk = (l: Listing | undefined, depth: number) => {
        for (const c of itemsOf<Thing & { replies?: Listing | "" }>(l)) {
          if (!c.body) continue;
          comments.push({ ...c, depth });
          if (c.replies) walk(c.replies, depth + 1);
        }
      };
      walk(tree, 0);
      const [post] = itemsOf<Post>(head);
      if (!post) throw new Error(`reddit: no post ${id}`);
      return { post, comments };
    },
    info: async (ids) =>
      ids.length ? itemsOf<Thing>(await call<Listing>("/api/info", { id: ids.join(",") })) : [],
  };
}
