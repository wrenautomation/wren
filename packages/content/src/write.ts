/**
 * Posts in the person's own words (Marketing → Write): one draft per platform, no model. A batch
 * is one text with a line of `---` between posts. Where a platform needs a title (Reddit) and none
 * is given, the first line is the title and the rest the body. Pure: the composer previews with it.
 */
import type { Media, Platform } from "@wren/core/content";
import { threadPosts, threadText, threadUnfit } from "@wren/core/content/thread";
import { PLATFORM_SPECS, unfitReason, wordsUnfit } from "./platforms.js";

/** The prompt version on a draft no model wrote. */
export const OWN_WORDS = "own";

/** How a post argues: his pick in Studio, kept on the idea. */
export const IDEA_ANGLES = ["Proof", "Contrarian", "How I do it", "Story"] as const;
export type IdeaAngle = (typeof IDEA_ANGLES)[number];

/** A batch's posts: split on a line of `---`, empty ones dropped. */
export function splitPosts(text: string): string[] {
  return text
    .split(/^\s*-{3,}\s*$/m)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * One platform's version of the words, or why it can't take them. A platform that needs a file
 * (TikTok's video) takes the words only with that file given.
 */
export function ownDraftOf(
  platform: Platform,
  text: string,
  title?: string | null,
  media?: Media | null,
): { text: string; title: string | null; extra?: Record<string, unknown> } | { reason: string } {
  const spec = PLATFORM_SPECS[platform];
  if (spec.words) {
    const body = text.trim();
    if (!body) return { reason: "empty text" };
    const unfit = wordsUnfit({ platform }, body);
    return unfit
      ? { reason: unfit }
      : { text: body, title: null, extra: { kind: spec.words.kind } };
  }
  if (spec.needsMedia) {
    if (!media)
      return { reason: `${spec.name} needs ${spec.needsMedia === "video" ? "a video" : "a file"}` };
    const unfit = unfitReason(spec, media);
    if (unfit) return { reason: unfit };
  }
  let body = text.trim();
  let head = title?.trim() || null;
  if (spec.title && !head) {
    const at = body.indexOf("\n");
    if (at < 0) return { reason: `${spec.name} needs a title and a body` };
    head = body.slice(0, at).trim();
    body = body.slice(at + 1).trim();
  }
  if (!body) return { reason: "empty text" };
  const unfit = wordsUnfit({ platform }, body);
  if (unfit) return { reason: unfit };
  if (spec.title && head && head.length > spec.title.maxChars)
    return { reason: `title is ${head.length} chars, over ${spec.title.maxChars}` };
  return { text: body, title: spec.title ? head : null };
}

/**
 * An X thread in his words: the posts split on a line of `---`, 3 to 7, each inside X's 280.
 * Checked without the link: the funnel's rides on the last post, and the yes checks it again.
 */
export function ownThreadOf(
  text: string,
): { text: string; title: null; extra: Record<string, unknown> } | { reason: string } {
  const posts = threadPosts(text);
  const unfit = threadUnfit(posts);
  return unfit
    ? { reason: unfit }
    : { text: threadText(posts), title: null, extra: { kind: "thread" } };
}
export { PLATFORM_SPECS } from "./platforms.js";
