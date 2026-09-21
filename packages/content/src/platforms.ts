/**
 * What each platform takes: the length it allows, whether a file is required,
 * and the shape the model is told to write. `postOf` turns a reviewed draft
 * into the channel port's `Post`.
 */
import type { Media, Platform, Post } from "@wren/core/content";
import type { ContentDraft } from "./schema.js";

export interface PlatformSpec {
  readonly platform: Platform;
  /** Hard cap on `text`; a draft over it is refused before it is stored. */
  readonly maxChars: number;
  /** A title beside the text (YouTube). */
  readonly title?: { readonly maxChars: number };
  /** The platform cannot post text alone. */
  readonly needsMedia?: "video" | "image-or-video";
  /** What the model is told to write, one line. */
  readonly shape: string;
}

export const PLATFORM_SPECS: Readonly<Record<Platform, PlatformSpec>> = {
  linkedin: {
    platform: "linkedin",
    maxChars: 3000,
    shape:
      "a LinkedIn post: a one-line hook, short paragraphs with blank lines between them, no hashtags, no emoji, ends with one plain question or take, under 1300 characters",
  },
  x: {
    platform: "x",
    maxChars: 280,
    shape: "one post on X: a single sharp point in plain words, no hashtags, under 240 characters",
  },
  youtube: {
    platform: "youtube",
    maxChars: 5000,
    title: { maxChars: 100 },
    needsMedia: "video",
    shape:
      "a YouTube title (under 70 characters, plain, says what the viewer gets) and a description: two short paragraphs of what the video shows and why it matters, no hashtags, no timestamps",
  },
  instagram: {
    platform: "instagram",
    maxChars: 2200,
    needsMedia: "video",
    shape:
      "an Instagram Reel caption: a first line that stands alone, two or three short lines after it, then up to five relevant hashtags on the last line",
  },
  tiktok: {
    platform: "tiktok",
    maxChars: 2200,
    needsMedia: "video",
    shape: "a TikTok caption: one or two short lines in plain words, then up to four hashtags",
  },
  facebook: {
    platform: "facebook",
    maxChars: 5000,
    shape:
      "a Facebook Page post: two or three short paragraphs in plain words, no hashtags, one question at the end",
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

/** The channel port's post for a draft: text, the file, the title where the platform has one. */
export function postOf(draft: Pick<ContentDraft, "text" | "title" | "media" | "extra">): Post {
  const extra: Record<string, unknown> = { ...draft.extra };
  if (draft.title) extra.title = draft.title;
  return {
    text: draft.text,
    ...(draft.media ? { media: draft.media } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}
