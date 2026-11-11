/**
 * The closed sets a breakdown labels with (designs/2026-10-25-competitor-analyzer.md): a hook
 * style, a call to action, a post's shape, a film's shots. Fixed and the same for every kind, so
 * pieces group: "which hook reaches in my space" is a count, not a read.
 */
export const HOOK_STYLES = [
  "contrarian",
  "demo-first",
  "result-first",
  "identity-call",
  "list-tease",
  "question",
  "story",
  "warning",
  "news",
  "how-to",
  "pattern-break",
  "other",
] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];
export const CTA_KINDS = [
  "comment-word",
  "follow",
  "link",
  "dm",
  "save-share",
  "none",
  "other",
] as const;
export type CtaKind = (typeof CTA_KINDS)[number];
/** What an ad offers, by kind (the `ad` rubric). */
export const AD_OFFERS = [
  "discount",
  "free-trial",
  "lead-magnet",
  "consult",
  "product",
  "event",
  "other",
] as const;
export const POST_FORMATS = [
  "talking-head",
  "screen-demo",
  "voiceover",
  "text-on-screen",
  "mixed",
] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

// a post's rubric: code counts, the model labels the shape
/** What a post is made of; null when the saved link does not say. */
export const POST_MEDIA = ["text", "image", "carousel", "doc", "video"] as const;
export type PostMedia = (typeof POST_MEDIA)[number];
/** Where its link is; code writes `body` or null (a first-comment link is not in the text). */
export const POST_LINKS = ["body", "comment", "none"] as const;
export type PostLink = (typeof POST_LINKS)[number];
export const POST_SHAPES = ["list", "story", "essay", "one-liner", "thread"] as const;
export type PostShape = (typeof POST_SHAPES)[number];

// a film's rubric: closed sets per shot, hand or code
export const SHOT_TYPES = ["ui", "b-roll", "graphic", "logo", "text-card", "talking-head"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];
export const SHOT_MOVES = [
  "static",
  "push",
  "pull",
  "pan",
  "track",
  "orbit",
  "roll",
  "rack-focus",
  "macro",
  "ui-zoom",
] as const;
export type ShotMove = (typeof SHOT_MOVES)[number];
export const SHOT_INS = ["cut", "dissolve", "fade", "whip"] as const;
export type ShotIn = (typeof SHOT_INS)[number];
export const SHOT_SOUNDS = ["music", "vo", "both", "silent"] as const;
export type ShotSound = (typeof SHOT_SOUNDS)[number];
/** Where a shot's bounds came from: a person's count, or the scene detector. */
export const SHOT_SRCS = ["hand", "scene"] as const;
export type ShotSrc = (typeof SHOT_SRCS)[number];
/** Whether a film's cut count can be trusted. */
export const CUTS_TRUSTS = ["ok", "low"] as const;
export type CutsTrust = (typeof CUTS_TRUSTS)[number];

/** The library's ad formats (`fb-public GET /ads`). */
export const AD_FORMATS = ["IMAGE", "VIDEO", "CAROUSEL", "DCO", "DPA"] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

/** Who wrote the breakdown's facts: the model and code, or a person. */
export const BREAKDOWN_BYS = ["model", "hand"] as const;
export type BreakdownBy = (typeof BREAKDOWN_BYS)[number];

/** One beat of a script: when it starts (seconds, when the transcript is timed) and what it does. */
export interface Beat {
  t: number | null;
  beat: string;
}

/** The kinds with a rubric: a hook, beats and facts to read. */
export const BROKEN_DOWN = ["reel", "video", "post", "film", "ad"] as const;
export type BrokenDown = (typeof BROKEN_DOWN)[number];
export const isBrokenDown = (k: string): k is BrokenDown =>
  (BROKEN_DOWN as readonly string[]).includes(k);

/** A breakdown as a Canon source's `breakdown` front matter holds it. */
export interface Breakdown {
  hookStyle: HookStyle;
  hook: string;
  hookWhy: string;
  topic: string;
  kind: BrokenDown;
  facts: Record<string, unknown>;
  beats: Beat[];
  ctaKind: CtaKind;
  cta: string | null;
  by: BreakdownBy;
  at: string;
}
