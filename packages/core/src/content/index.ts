/**
 * The content channel port: what publishing organic content to a platform
 * looks like from this repo, whichever way the adapter does it (the
 * platform's API, or an autobrowse flow where the API is gated or absent).
 * Callers see one interface; a row says how it was fetched.
 * Design: designs/2026-09-21-content-channels.md.
 */

export * from "./autobrowse.js";
export * from "./do.js";

export type Platform =
  | "linkedin"
  | "reddit"
  | "youtube"
  | "x"
  | "instagram"
  | "facebook"
  | "tiktok";
export const PLATFORMS: readonly Platform[] = [
  "linkedin",
  "reddit",
  "youtube",
  "x",
  "instagram",
  "facebook",
  "tiktok",
];
export type FetchedWith = "api" | "browser";

export interface Media {
  kind: "image" | "video";
  /** A local path or a URL the adapter can read. */
  source: string;
  /** Video title, image alt text. */
  title?: string;
}

/**
 * Where media becomes a URL a platform (or the autobrowse box) can fetch:
 * a local file is put in the media store first; an `s3://bucket/key` the
 * CLI already put there is just signed. Nothing else reads the store.
 */
export interface MediaHost {
  /** A URL good for a while, for a local path or an `s3://` object. */
  host(source: string): Promise<string>;
}

export const isUrl = (source: string): boolean => /^https?:\/\//i.test(source);
export const isStoredMedia = (source: string): boolean => /^s3:\/\//i.test(source);

/** A URL for the platform: the source itself when it is one, else the host's copy. */
export async function publicUrlOf(source: string, host: MediaHost | undefined, platform: string) {
  if (isUrl(source)) return source;
  if (!host) throw new Error(`${platform}: a public URL is needed for media (or a MediaHost)`);
  return host.host(source);
}

/**
 * What an adapter hands a site that reads the file itself (YouTube, X):
 * a URL as is; a stored object or, with a host, a local path as the
 * host's URL; a local path with no host as the path (the box's own disk).
 */
export async function mediaFileOf(source: string, host: MediaHost | undefined, platform: string) {
  if (isUrl(source)) return source;
  if (isStoredMedia(source)) return publicUrlOf(source, host, platform);
  return host ? host.host(source) : source;
}

/** What to publish. Text is the body (a LinkedIn post, a YouTube description). */
export interface Post {
  text: string;
  media?: Media;
  /** ISO time to publish at; absent = now. */
  scheduledFor?: string;
  /** Platform extras: YouTube title/tags/visibility, LinkedIn visibility, Reddit subreddit. Validated by the adapter. */
  extra?: Record<string, unknown>;
}

export interface Published {
  id: string;
  url: string;
  publishedAt: string;
  fetchedWith: FetchedWith;
}

/** A list row: no bodies; the detail lives on the platform (`url`) or in `metrics`. */
export interface PublishedRow extends Published {
  /** First ~120 chars of the text, for a listing. */
  preview: string;
}

export interface Metrics {
  id: string;
  /** Impressions on LinkedIn, views on YouTube. */
  views: number;
  reactions: number;
  comments: number;
  shares: number;
  asOf: string;
  fetchedWith: FetchedWith;
}

export interface CommentRow {
  id: string;
  postId: string;
  author: string;
  text: string;
  at: string;
  /** Set when we answered it (the reply's id). */
  repliedWith?: string;
}

export interface ListQuery {
  limit?: number;
  /** Cursor: the last row's `publishedAt`; rows strictly older come back. */
  before?: string;
}

export const CONTENT_LIST_LIMIT = 100;

export interface ContentChannel {
  readonly platform: Platform;
  /** Irreversible: an orchestrator gates it like any other irreversible step. */
  publish(post: Post): Promise<Published>;
  list(q?: ListQuery): Promise<PublishedRow[]>;
  metrics(id: string): Promise<Metrics>;
  comments(id: string, q?: ListQuery): Promise<CommentRow[]>;
  /** Absent when the platform gives no way to answer (LinkedIn without the partner API). */
  reply?(commentId: string, text: string): Promise<void>;
}

/** One page of rows newest first, from a full newest-first array: the paging rule every adapter follows. */
export function pageOf<T extends { publishedAt: string } | { at: string }>(
  rows: readonly T[],
  q: ListQuery = {},
): T[] {
  const limit = Math.min(Math.max(q.limit ?? CONTENT_LIST_LIMIT, 1), CONTENT_LIST_LIMIT);
  const when = (r: T) => ("publishedAt" in r ? r.publishedAt : r.at);
  const sorted = [...rows].sort((a, b) => when(b).localeCompare(when(a)));
  const from = q.before ? sorted.filter((r) => when(r) < (q.before as string)) : sorted;
  return from.slice(0, limit);
}

export const previewOf = (text: string, max = 120): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** In-memory channel for tests and dry runs: publishes are kept, metrics are zeros until `count`. */
export function fakeContentChannel(
  platform: Platform,
  o: { now?: () => Date; urlOf?: (id: string) => string } = {},
): ContentChannel & {
  posts: Array<Published & { post: Post }>;
  count(id: string, m: Partial<Omit<Metrics, "id" | "asOf" | "fetchedWith">>): void;
  receive(c: Omit<CommentRow, "repliedWith">): void;
} {
  const now = o.now ?? (() => new Date());
  const urlOf = o.urlOf ?? ((id: string) => `https://${platform}.test/p/${id}`);
  const posts: Array<Published & { post: Post }> = [];
  const metrics = new Map<string, Metrics>();
  const comments: CommentRow[] = [];
  let n = 0;
  return {
    platform,
    posts,
    count(id, m) {
      const cur = metrics.get(id) ?? {
        id,
        views: 0,
        reactions: 0,
        comments: 0,
        shares: 0,
        asOf: now().toISOString(),
        fetchedWith: "api",
      };
      metrics.set(id, { ...cur, ...m, asOf: now().toISOString() });
    },
    receive(c) {
      comments.push({ ...c });
    },
    async publish(post) {
      const id = `${platform}-${++n}`;
      const row = {
        id,
        url: urlOf(id),
        publishedAt: post.scheduledFor ?? now().toISOString(),
        fetchedWith: "api" as const,
        post,
      };
      posts.push(row);
      return { id: row.id, url: row.url, publishedAt: row.publishedAt, fetchedWith: "api" };
    },
    async list(q) {
      return pageOf(
        posts.map(({ post, ...p }) => ({ ...p, preview: previewOf(post.text) })),
        q,
      );
    },
    async metrics(id) {
      const m = metrics.get(id);
      if (!m && !posts.some((p) => p.id === id)) throw new Error(`no post ${id} on ${platform}`);
      return (
        m ?? {
          id,
          views: 0,
          reactions: 0,
          comments: 0,
          shares: 0,
          asOf: now().toISOString(),
          fetchedWith: "api",
        }
      );
    },
    async comments(id, q) {
      return pageOf(
        comments.filter((c) => c.postId === id),
        q,
      );
    },
    async reply(commentId, text) {
      const c = comments.find((x) => x.id === commentId);
      if (!c) throw new Error(`no comment ${commentId}`);
      c.repliedWith = `reply-${++n}:${previewOf(text, 20)}`;
    },
  };
}
