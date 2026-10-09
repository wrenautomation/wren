/**
 * Sites (designs/2026-10-07-sites.md): every page we run, in one list. The words here are the
 * model's own: kinds, sources, states, where a visit came from. No niche, no client.
 */

/** What a page is for. */
export const PAGE_KINDS = [
  "lander",
  "listicle",
  "pitch",
  "demo",
  "booking",
  "thank-you",
  "portal",
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** `data`: rows rendered by our template. `code`: a page built in code, registered here. */
export const PAGE_SOURCES = ["data", "code"] as const;
export type PageSource = (typeof PAGE_SOURCES)[number];

export const PAGE_STATUSES = ["draft", "live", "retired"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

/** Where the page sits in the funnel: first touch, warming up, or the ask. */
export const PAGE_STAGES = ["reach", "trust", "convert"] as const;
export type PageStage = (typeof PAGE_STAGES)[number];

/** How a version came to be. */
export const VERSION_ORIGINS = ["offer", "edit", "ai", "copy", "restore"] as const;
export type VersionOrigin = (typeof VERSION_ORIGINS)[number];

/** What the tracker counts. `start`: someone touched a form's first field. */
export const EVENT_NAMES = ["view", "cta", "form", "book", "start", "step"] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** Where a visit came from, read off its utm on arrival (`channelOf`). */
export const CHANNELS = ["ads", "organic", "outreach", "referral", "direct", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * A page split (an A/B test at the edge): running, a winner asked to become the page (waiting in
 * To approve), shipped on that yes, or stopped.
 */
export const SPLIT_STATES = ["running", "shipping", "shipped", "stopped"] as const;
export type SplitState = (typeof SPLIT_STATES)[number];

/** What a split is judged on: forms sent, booking clicks, or won deals (Wren's pages). */
export const SPLIT_GOALS = ["forms", "books", "won"] as const;
export type SplitGoal = (typeof SPLIT_GOALS)[number];

/** A split's arms, in order: A is the page whose address is split. */
export const ARM_LABELS = ["A", "B", "C", "D", "E"] as const;
export type ArmLabel = (typeof ARM_LABELS)[number];

/** A form's split: running, B made the form (`shipped`), or ended with A kept (`stopped`). */
export const FORM_SPLIT_STATES = ["running", "shipped", "stopped"] as const;
export type FormSplitState = (typeof FORM_SPLIT_STATES)[number];
/** A form split has two arms: the form as it is, and B. */
export const FORM_ARMS = ["A", "B"] as const;
export type FormArm = (typeof FORM_ARMS)[number];

/** A hosted form's address on its owner's host: `/o/f/<slug>`. */
export const FORM_PREFIX = "/o/f/";
export const formUrl = (host: string, slug: string) => `https://${host}${FORM_PREFIX}${slug}`;

/** Wren's own domain: its pages live at `https://<it>/o/<slug>`. */
export const WREN_SITE = "wrenautomation.com";
/** The path every data page and the tracker live under. */
export const PAGE_PREFIX = "/o/";

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const SLUG_MAX = 80;

/** A slug from any words: lower case, dashes, at most 80. */
export function slugOf(words: string): string {
  return words
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** A data page's address on its owner's host. */
export const pageUrl = (host: string, slug: string) => `https://${host}${PAGE_PREFIX}${slug}`;

const PAID = new Set(["paid", "cpc", "ppc", "ads", "paid_social", "paidsocial", "display"]);
const OUTREACH = new Set(["outreach", "email", "sms", "dm", "text", "call"]);
const ORGANIC = new Set(["organic", "social", "video", "post"]);

/**
 * Where a visit came from: the medium first (the lander's `/go/` links set paid, organic or
 * outreach), then any utm at all, then a referrer.
 */
export function channelOf(t: {
  source?: string | null;
  medium?: string | null;
  ref?: string | null;
}): Channel {
  const medium = (t.medium ?? "").toLowerCase();
  if (PAID.has(medium)) return "ads";
  if (OUTREACH.has(medium)) return "outreach";
  if (ORGANIC.has(medium)) return "organic";
  if (t.source || medium) return "other";
  return t.ref ? "referral" : "direct";
}
