/**
 * An X thread in one draft (designs/2026-10-07-content-funnel.md, build order 2): the posts live in
 * the draft's text, split by a line holding only `---`, so the draft box, Ask Claude, history and
 * undo work on it like any post. The editor, the preview, the facts guard and the publisher all
 * split it here. The funnel link rides on the last post; the first carries none.
 */

/** The line between two posts in the stored text. */
export const THREAD_BREAK = "\n\n---\n\n";
export const THREAD_MIN = 3;
export const THREAD_MAX = 7;
/** X's cap on one post. */
export const X_POST_MAX = 280;
/** X counts any link as this many characters, whatever its length. */
export const X_LINK_CHARS = 23;

const BREAK = /\n[ \t]*-{3,}[ \t]*(?:\n|$)/;
const URL = /https?:\/\/\S+/gi;

/** The posts of a thread's text, trimmed, empty ones dropped. */
export function threadPosts(text: string): string[] {
  return text
    .split(BREAK)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** The stored text of a thread's posts. */
export const threadText = (posts: readonly string[]): string =>
  posts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(THREAD_BREAK);

/** A post's length as X counts it: characters, a link as 23. */
export function xLength(text: string): number {
  let n = 0;
  const rest = text.replace(URL, () => {
    n += X_LINK_CHARS;
    return "";
  });
  return n + [...rest].length;
}

/** The posts as they go out: the link on its own line at the end of the last one. */
export function withLink(posts: readonly string[], link: string | null | undefined): string[] {
  if (!link || posts.length === 0) return [...posts];
  const last = posts.length - 1;
  return posts.map((p, i) => (i === last ? `${p.trimEnd()}\n\n${link}` : p));
}

/**
 * Why the thread can't go out as it stands, or null: 3 to 7 posts, each inside 280 as X counts,
 * the last one with its link. The first post never carries a link.
 */
export function threadUnfit(posts: readonly string[], link?: string | null): string | null {
  if (posts.length < THREAD_MIN) return `a thread is ${THREAD_MIN} to ${THREAD_MAX} posts`;
  if (posts.length > THREAD_MAX) return `a thread is ${THREAD_MIN} to ${THREAD_MAX} posts`;
  if (/https?:\/\//i.test(posts[0] ?? "")) return "the first post carries no link";
  const out = withLink(posts, link);
  for (const [i, p] of out.entries()) {
    const n = xLength(p);
    if (n > X_POST_MAX)
      return `post ${i + 1} is ${n} characters${link && i === out.length - 1 ? " with its link" : ""}, over ${X_POST_MAX}`;
  }
  return null;
}

/** True of a draft whose words are a thread. */
export const isThread = (d: {
  platform: string;
  extra?: Readonly<Record<string, unknown>> | null;
}): boolean => d.platform === "x" && d.extra?.kind === "thread";
