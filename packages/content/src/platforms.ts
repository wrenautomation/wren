/**
 * What each platform takes: the length it allows, whether a file is required,
 * and the shape the model is told to write. `postOf` turns a reviewed draft
 * into the channel port's `Post`.
 */
import type { Media, Platform, Post } from "@wren/core/content";
import { fieldsOf } from "@wren/core/content/shapes";
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
    maxChars: 280,
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
  const linked = link ? `${draft.text.trimEnd()}\n\n${link}` : draft.text;
  return {
    text: linked.length <= PLATFORM_SPECS[draft.platform].maxChars ? linked : draft.text,
    ...(draft.media ? { media: draft.media } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}
