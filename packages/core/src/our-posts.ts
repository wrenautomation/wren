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
  "concrete thing beats three general ones. Open with your point, never with agreement (no " +
  '"You\'re right", "Great point", "X\'s point hits home"). No closing question unless it is ' +
  "specific to them. No \"it's not just X, it's Y\". No dashes. Sound like a text, not a post.";

/** A comment as it goes out: dashes become commas (models lean on them; readers flag them). */
export const cleanComment = (text: string): string =>
  text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+--\s+/g, ", ")
    .trim();

/** Stock moves a comment must not make; each match names what to cut. */
const STOCK: Array<[RegExp, string]> = [
  [/^\s*(you'?re|you are) (so |absolutely |spot on|right)/i, 'opening with "You\'re right"'],
  [/^\s*(great|good|love this|totally|100%|couldn'?t agree)/i, "opening with praise or agreement"],
  [/^[^.!?]{0,60}'s (point|take) (on|about)/i, "opening by naming their point"],
  [/\bit'?s not (just |only |about )?[^.;]{1,60}[,;] it'?s\b/i, "\"it's not X, it's Y\""],
  [/\bnot just about\b/i, '"not just about"'],
  [
    /\b(what'?s the one|what'?s one|how do you|curious how|what do you think)\b[^?]*\?\s*$/i,
    "a closing question to them",
  ],
];

/** What reads as stock in a comment; empty when it's plain. */
export const stockPhrases = (text: string): string[] =>
  STOCK.filter(([re]) => re.test(text)).map(([, what]) => what);

/**
 * One more ask when a comment reads stock: the model gets the moves to cut. The second answer
 * stands either way (the grounding guard still checks it).
 */
export async function plainComment<T>(
  ask: (fix: string | null) => Promise<{ text: string; result: T }>,
  fix: string | null,
): Promise<{ text: string; result: T }> {
  const a = await ask(fix);
  const stock = stockPhrases(a.text);
  if (!stock.length) return a;
  const note = `Rewrite it plainly. Cut: ${stock.join("; ")}. Start with your own point.`;
  return ask(fix ? `${fix}\n${note}` : note);
}

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
