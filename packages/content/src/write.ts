/**
 * Posts in the person's own words (Marketing → Write): one draft per platform, no model. A batch
 * is one text with a line of `---` between posts. Where a platform needs a title (Reddit) and none
 * is given, the first line is the title and the rest the body. Pure: the composer previews with it.
 */
import type { Platform } from "@wren/core/content";
import { PLATFORM_SPECS, wordsUnfit } from "./platforms.js";

/** The prompt version on a draft no model wrote. */
export const OWN_WORDS = "own";

/** A batch's posts: split on a line of `---`, empty ones dropped. */
export function splitPosts(text: string): string[] {
  return text
    .split(/^\s*-{3,}\s*$/m)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** One platform's version of the words, or why it can't take them. */
export function ownDraftOf(
  platform: Platform,
  text: string,
  title?: string | null,
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
  if (spec.needsMedia)
    return { reason: `${spec.name} needs ${spec.needsMedia === "video" ? "a video" : "a file"}` };
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
export { PLATFORM_SPECS } from "./platforms.js";
