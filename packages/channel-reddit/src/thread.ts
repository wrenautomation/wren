/**
 * A Reddit post and its comments as one conversation (designs/2026-10-15-engage-threads.md):
 * `/comments/{article}` read to any depth, flattened oldest first, with each comment's parent.
 * "Load more" stubs are counted, not opened.
 */
import type { ThreadNode, ThreadRead } from "@wren/core/outreach";
import { type Listing, redditUrl } from "./content.js";

/** A `t1` or `t3` as `/comments/{article}` carries it; only what is read. */
interface Node {
  id?: string;
  name?: string;
  parent_id?: string;
  author?: string;
  body?: string;
  title?: string;
  selftext?: string;
  subreddit?: string;
  permalink?: string;
  created_utc?: number;
  num_comments?: number;
  thumbnail?: string;
  url?: string;
  post_hint?: string;
  preview?: { images?: Array<{ source?: { url?: string } }> };
  replies?: Listing | "";
  /** A `more` stub: how many it hides. */
  count?: number;
  children?: string[];
}

/** Every read of a thread asks the same: deep, oldest first, as many as Reddit gives. */
export const THREAD_QUERY = { raw_json: 1, limit: 500, depth: 10, sort: "old" } as const;
/** Ancestors of a focused comment Reddit adds above it. */
export const FOCUS_CONTEXT = 8;

const bare = (ref: string) => ref.replace(/^t[13]_/, "");
const iso = (utc: number | undefined) => (utc ? new Date(utc * 1000).toISOString() : null);
const kids = (l: Listing | "" | undefined) =>
  ((l && typeof l === "object" ? l.data?.children : null) ?? []) as unknown as Array<{
    kind: string;
    data: Node;
  }>;

/** A picture for the post: its own image, else a real thumbnail (Reddit's words aren't ones). */
function mediaOf(p: Node): string | null {
  const src = p.preview?.images?.[0]?.source?.url;
  if (src) return src;
  if (p.post_hint === "image" && p.url) return p.url;
  return p.thumbnail && /^https?:\/\//.test(p.thumbnail) ? p.thumbnail : null;
}

/** The query `thread` sends: the whole post, or the conversation around one comment. */
export const threadQuery = (focus?: string | null) =>
  focus ? { ...THREAD_QUERY, comment: bare(focus), context: FOCUS_CONTEXT } : { ...THREAD_QUERY };

/** `[post listing, comments listing]` as one conversation; `now` dates a comment with none. */
export function threadOf(
  post: string,
  answer: [Listing, Listing] | unknown,
  now: () => Date,
): ThreadRead {
  const [head, tree] = (Array.isArray(answer) ? answer : []) as [Listing?, Listing?];
  const p = kids(head)[0]?.data ?? {};
  const ref = p.name ?? `t3_${bare(post)}`;
  const nodes: ThreadNode[] = [];
  let more = 0;
  const walk = (l: Listing | "" | undefined, parent: string) => {
    for (const c of kids(l)) {
      if (c.kind === "more") {
        more += c.data.count ?? c.data.children?.length ?? 0;
        continue;
      }
      const d = c.data;
      const name = d.name ?? (d.id ? `t1_${d.id}` : null);
      if (c.kind !== "t1" || !name) continue;
      nodes.push({
        ref: name,
        parent: d.parent_id ?? parent,
        // A deleted comment keeps its place; its replies still hang off it.
        handle: d.author ?? "[deleted]",
        text: d.body ?? "",
        at: iso(d.created_utc) ?? now().toISOString(),
        url: redditUrl(d.permalink ? `${d.permalink}?context=3` : `/comments/${bare(ref)}`),
      });
      walk(d.replies, name);
    }
  };
  walk(tree, ref);
  nodes.sort((a, b) => a.at.localeCompare(b.at) || a.ref.localeCompare(b.ref));
  return {
    post: {
      ref,
      title: p.title ?? null,
      text: p.selftext || null,
      handle: p.author ?? null,
      url: redditUrl(p.permalink ?? `/comments/${bare(ref)}`),
      place: p.subreddit ?? null,
      media: mediaOf(p),
      at: iso(p.created_utc),
      count: typeof p.num_comments === "number" ? p.num_comments : null,
    },
    nodes,
    more,
  };
}
