/**
 * What we've posted, as the material for a comment on someone else's post or thread. A comment
 * takes one of our points in fresh words (agree and add why, push back, the idea behind it) and
 * never retells theirs. Content reads the posts (`@wren/content/our-posts`); each target picks the
 * ones sharing the most words with it ($0).
 */

export interface OurPost {
  platform: string;
  text: string;
}

/** The voice rule every comment on someone else's words carries. */
export const COMMENT_RULE =
  "Talk like a peer who has thought about this. Never restate, summarize or praise what they " +
  "wrote: they know what they said. Take a side: agree and add why, or push back and say why. " +
  "Bring one point from our posts below in fresh words, or the high-level idea behind it. One " +
  "concrete thing beats three general ones.";

const bag = (s: string) => new Set(s.toLowerCase().match(/[a-z]{5,}/g) ?? []);

/** Up to `n` of our posts closest to `words`; none close, the newest two (posts come newest first). */
export function postsFor(words: string, posts: readonly OurPost[], n = 3): OurPost[] {
  const want = bag(words);
  const near = posts
    .map((p) => ({ p, hits: [...bag(p.text)].filter((w) => want.has(w)).length }))
    .filter((x) => x.hits >= 2)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, n)
    .map((x) => x.p);
  return near.length ? near : posts.slice(0, 2);
}

const POST_CHARS = 700;

/** The prompt's block of our posts; "" with none. */
export function ourPostsBlock(posts: readonly OurPost[]): string {
  if (!posts.length) return "";
  const lines = posts.map(
    (p) => `- (${p.platform}) ${p.text.replace(/\s+/g, " ").trim().slice(0, POST_CHARS)}`,
  );
  return `What we've posted (ours to draw on, in fresh words; never quote or link it):\n${lines.join("\n")}`;
}
