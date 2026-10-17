/**
 * What each platform takes: the length it allows, whether a file is required,
 * and the shape the model is told to write. `postOf` turns a reviewed draft
 * into the channel port's `Post`.
 */
import type { Media, Platform, Post } from "@wren/core/content";
import { fieldsOf, ShapeError } from "@wren/core/content/shapes";
import { carouselUnfit, isCarousel } from "@wren/core/content/slides";
import {
  isThread,
  threadPosts,
  threadText,
  threadUnfit,
  WREN_X_SUBSCRIPTION,
  withLink,
  xPostMax,
} from "@wren/core/content/thread";
import type { ContentDraft } from "./schema.js";

export interface PlatformSpec {
  readonly platform: Platform;
  /** How a person writes it: "LinkedIn". */
  readonly name: string;
  /** Hard cap on `text`; a draft over it is refused before it is stored. */
  readonly maxChars: number;
  /** A title beside the text (YouTube). */
  readonly title?: { readonly maxChars: number };
  /** The platform cannot post text alone. */
  readonly needsMedia?: "video" | "image-or-video";
  /** Words alone go out as this kind instead (YouTube: a community post). */
  readonly words?: { readonly kind: string; readonly name: string };
  /** What the model is told to write, one line. */
  readonly shape: string;
  /**
   * The lander's `/go/<channel>` code, so a visit names the platform (lander src/data/links.json).
   * Whether a post carries its link is the funnel's rule (`funnel.ts`).
   */
  readonly goCode: string;
  /**
   * Lines a feed shows before "see more", on a laptop and on a phone; null shows the whole post,
   * 0 none of it. As the apps cut them in 2026: tune here when one changes.
   */
  readonly feed: { readonly laptop: number | null; readonly phone: number | null };
}

export const PLATFORM_SPECS: Readonly<Record<Platform, PlatformSpec>> = {
  linkedin: {
    platform: "linkedin",
    maxChars: 3000,
    shape:
      "a LinkedIn post: a one-line hook, short paragraphs with blank lines between them, no hashtags, no emoji, ends with one plain question or take, under 1300 characters",
    name: "LinkedIn",
    goCode: "li",
    feed: { laptop: 3, phone: 3 },
  },
  reddit: {
    platform: "reddit",
    maxChars: 40000,
    title: { maxChars: 300 },
    shape:
      "a Reddit text post: a plain title that states the point or the question (under 120 characters), then a body written like a practitioner sharing what they did and learned, specifics and numbers, no pitch, no links, no emoji, no hashtags, under 2000 characters",
    name: "Reddit",
    goCode: "rd",
    feed: { laptop: 3, phone: 3 },
  },
  x: {
    platform: "x",
    // Wren's account fact: Premium posts one long post. A thread's posts stay at 280 each.
    maxChars: xPostMax(WREN_X_SUBSCRIPTION),
    shape: "one post on X: a single sharp point in plain words, no hashtags, under 240 characters",
    name: "X",
    goCode: "x",
    feed: { laptop: null, phone: null },
  },
  youtube: {
    platform: "youtube",
    maxChars: 5000,
    title: { maxChars: 100 },
    needsMedia: "video",
    words: { kind: "community", name: "YouTube post" },
    shape:
      "a YouTube title (under 70 characters, plain, says what the viewer gets) and a description: two short paragraphs of what the video shows and why it matters, no hashtags, no timestamps",
    name: "YouTube",
    goCode: "yt",
    feed: { laptop: 3, phone: 0 },
  },
  instagram: {
    platform: "instagram",
    maxChars: 2200,
    needsMedia: "video",
    shape:
      "an Instagram Reel caption: a first line that stands alone, two or three short lines after it, then up to five relevant hashtags on the last line",
    name: "Instagram",
    goCode: "ig",
    feed: { laptop: 2, phone: 2 },
  },
  // Text up to 500, a photo or a video riding along (graph.threads.net through autobrowse).
  threads: {
    platform: "threads",
    maxChars: 500,
    shape:
      "a Threads post: one plain point in conversational words, a line or two, no hashtags, under 400 characters",
    name: "Threads",
    goCode: "th",
    feed: { laptop: null, phone: null },
  },
  tiktok: {
    platform: "tiktok",
    maxChars: 2200,
    needsMedia: "video",
    shape: "a TikTok caption: one or two short lines in plain words, then up to four hashtags",
    name: "TikTok",
    goCode: "tt",
    feed: { laptop: 2, phone: 1 },
  },
  facebook: {
    platform: "facebook",
    maxChars: 5000,
    shape:
      "a Facebook Page post: two or three short paragraphs in plain words, no hashtags, one question at the end",
    name: "Facebook",
    goCode: "fb",
    feed: { laptop: 5, phone: 3 },
  },
  // A client's Profile only (designs/2026-10-07-client-social.md): no `/go/` link rides on it.
  google_business: {
    platform: "google_business",
    maxChars: 1500,
    shape:
      "a Google Business Profile update: two or three short sentences on one offer, event or piece of news, plain words, no hashtags, no links in the text",
    name: "Business Profile",
    goCode: "gb",
    feed: { laptop: 3, phone: 3 },
  },
};

/** Why the platform cannot take this idea, or null when it can. */
export function unfitReason(spec: PlatformSpec, media: Media | null | undefined): string | null {
  if (!spec.needsMedia) return null;
  if (!media) return `${spec.platform} needs a ${spec.needsMedia === "video" ? "video" : "file"}`;
  if (spec.needsMedia === "video" && media.kind !== "video")
    return `${spec.platform} needs a video, not an image`;
  return null;
}

/**
 * Why these words can't be the draft's text, or null: the platform's cap, or for an X thread
 * 3 to 7 posts of 280 each (`@wren/core/content/thread`).
 */
export function wordsUnfit(
  d: { platform: Platform; extra?: Readonly<Record<string, unknown>> | null },
  text: string,
): string | null {
  if (isThread(d)) return threadUnfit(threadPosts(text));
  const max = PLATFORM_SPECS[d.platform].maxChars;
  return text.length > max
    ? `it is ${text.length} characters, over the ${max} ${PLATFORM_SPECS[d.platform].name} takes. Cut it down`
    : null;
}

/**
 * The channel port's post for a draft: text, the file, its fields (the title where the platform
 * has one), parsed against its shape: a bad field throws `ShapeError` before anything sends.
 * `link` goes on its own line at the end, dropped if the text would pass the platform's cap.
 */
export function postOf(
  draft: Pick<ContentDraft, "text" | "title" | "media" | "extra" | "platform">,
  link?: string | null,
): Post {
  const extra: Record<string, unknown> = fieldsOf(draft.platform, {
    ...draft.extra,
    ...(draft.title ? { title: draft.title } : {}),
  });
  // A carousel goes out as its drawn files (the adapter uploads them), so they must match it.
  const unfit = isCarousel(draft) ? carouselUnfit(draft) : null;
  if (unfit) throw new ShapeError(`Carousel: ${unfit}`);
  if (isThread(draft)) {
    // The link rides on the last post; dropped, like a single post's, if it would pass 280.
    const posts = threadPosts(draft.text);
    const out = link && !threadUnfit(posts, link) ? withLink(posts, link) : posts;
    return {
      text: threadText(out),
      ...(draft.media ? { media: draft.media } : {}),
      extra,
    };
  }
  const linked = link ? `${draft.text.trimEnd()}\n\n${link}` : draft.text;
  return {
    text: linked.length <= PLATFORM_SPECS[draft.platform].maxChars ? linked : draft.text,
    ...(draft.media ? { media: draft.media } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/** Starts the line of a post that may have gone out: it waits in To approve. */
export const MAY_HAVE_GONE_OUT = "May have gone out";

/**
 * The words a listing of our own posts may show for this draft, for a look after a lost publish
 * (designs/2026-10-16-maybe-sent.md): the text as sent, the draft's own text (a short one with
 * its link appended matches only bare), its title (YouTube, Reddit). A thread lists its first post.
 */
export function lookWords(
  draft: Pick<ContentDraft, "text" | "title" | "extra" | "platform">,
  sent?: Pick<Post, "text"> | null,
): string[] {
  const words = isThread(draft)
    ? [threadPosts(draft.text)[0], sent ? threadPosts(sent.text)[0] : null]
    : [sent?.text, draft.text];
  return [...new Set([...words, draft.title].filter((w): w is string => !!w?.trim()))];
}

/** A draft as a person knows it, for what a refusal says: its title and platform, never its id. */
export function named(r: { title?: string | null; text: string; platform: string }): string {
  const words = (r.title || r.text || "").replace(/\s+/g, " ").trim();
  const short = words.length > 60 ? `${words.slice(0, 57)}…` : words;
  const where = PLATFORM_SPECS[r.platform as Platform]?.name ?? r.platform;
  return short ? `"${short}" on ${where}` : `The ${where} draft`;
}

/** A draft gone from the list since it was read: deleted, or another tab moved it. */
export const GONE = "That draft isn't here any more. Reload the page to see what's left.";

/**
 * Why a draft can't `doing` ("be changed", "be approved") in the state it's in, naming it and
 * saying what to do. Draft, approved and failed are open; the rest are past changing.
 */
export function lockedWhy(
  r: {
    title?: string | null;
    text: string;
    platform: string;
    status: string;
    error?: string | null;
  },
  doing: string,
): string {
  const who = named(r);
  if (r.status === "publishing" && r.error?.startsWith(MAY_HAVE_GONE_OUT))
    return `${who} may have gone out, so it can't ${doing}. Check it in To approve first.`;
  if (r.status === "publishing")
    return `${who} is posting now, so it can't ${doing}. Reload in a minute.`;
  if (r.status === "published") return `${who} is already posted, so it can't ${doing}.`;
  if (r.status === "rejected")
    return `${who} was rejected, so it can't ${doing}. Draft it again from its idea to use it.`;
  return `${who} can't ${doing} right now. Reload the page and try again.`;
}

/** A refusal about one draft: its name, then why, as one sentence ending in a stop. */
export function aboutDraft(
  r: { title?: string | null; text: string; platform: string },
  why: string,
): string {
  const said = why.trim().replace(/[.]+$/, "");
  return `${named(r)}: ${said}.`;
}
