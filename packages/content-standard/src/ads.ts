/**
 * Meta Ad Library ads (designs/2026-11-11-competitor-ads.md): autobrowse's `fb-public GET /ads`
 * answer, read into one Canon source per ad. The page a read writes carries an `## Ad` facts
 * fence that feeds the breakdown's facts; the winners get the winner tags.
 */
import { z } from "zod";
import { AD_FORMATS, type AdFormat } from "./labels.js";

export interface AdVideo {
  hd?: string | null;
  sd?: string | null;
  poster?: string | null;
}

export interface AdCard {
  headline?: string | null;
  body?: string | null;
  cta?: string | null;
  link?: string | null;
  caption?: string | null;
  image?: string | null;
  video?: AdVideo | null;
}

/** One ad as `fb-public GET /ads` answers it (autobrowse 34722b9). */
export interface LibraryAd {
  libraryId: string;
  advertiser?: {
    id?: string | null;
    name?: string | null;
    url?: string | null;
    likes?: number | null;
  } | null;
  active: boolean;
  started?: string | null;
  ended?: string | null;
  daysRunning?: number | null;
  platforms?: string[] | null;
  versions?: number | null;
  format?: string | null;
  headline?: string | null;
  body?: string | null;
  cta?: string | null;
  ctaType?: string | null;
  link?: string | null;
  caption?: string | null;
  media?: {
    images?: { url?: string | null; resized?: string | null }[];
    videos?: AdVideo[];
  } | null;
  cards?: AdCard[] | null;
  raw?: Record<string, unknown> | null;
  [field: string]: unknown;
}

export interface AdsAnswer {
  query: Record<string, unknown>;
  pageId?: string | null;
  /** False: the page did not resolve. */
  found?: boolean;
  /** The library's own count. */
  total?: number | null;
  pages?: number;
  ads: LibraryAd[];
}

/** Winner: still paid for after this many days. */
export const WINNER_DAYS = 30;
/** Winner: this many ads share the creative. */
export const WINNER_VERSIONS = 3;
/** The tags a winner gets: a Canon reference. */
export const WINNER_TAGS = ["winning-ad", "reference"] as const;

export const adUrl = (libraryId: string): string =>
  `https://www.facebook.com/ads/library/?id=${encodeURIComponent(libraryId)}`;

/** An advertiser keeps paying for what works: a long runner, or one creative in many ads. */
export const isWinner = (a: {
  active: boolean;
  daysRunning?: number | null;
  versions?: number | null;
}): boolean =>
  (a.active && (a.daysRunning ?? 0) >= WINNER_DAYS) || (a.versions ?? 1) >= WINNER_VERSIONS;

const formatOf = (f: string | null | undefined): AdFormat | null =>
  f && (AD_FORMATS as readonly string[]).includes(f) ? (f as AdFormat) : null;

/** The first line of a text, trimmed; a DPA template (`{{product.name}}`) is no line. */
const lineOf = (s: string | null | undefined): string | null => {
  const l = s
    ?.split("\n")
    .find((x) => x.trim())
    ?.trim();
  return l && !/\{\{.*\}\}/.test(l) ? l : null;
};

export function adTitle(ad: LibraryAd): string {
  const who = ad.advertiser?.name?.trim() || "Ad";
  const line =
    lineOf(ad.headline) ?? lineOf(ad.body) ?? lineOf(ad.cards?.[0]?.headline) ?? ad.libraryId;
  return `${who}: ${line}`.slice(0, 200);
}

/** Every video in the ad, its own then its cards'. */
export const adVideos = (ad: LibraryAd): AdVideo[] => [
  ...(ad.media?.videos ?? []),
  ...(ad.cards ?? []).flatMap((c) => (c.video ? [c.video] : [])),
];

/** Every image URL in the ad, its own then its cards', each once. */
export const adImages = (ad: LibraryAd): string[] => [
  ...new Set(
    [
      ...(ad.media?.images ?? []).map((i) => i.url ?? i.resized ?? null),
      ...(ad.cards ?? []).map((c) => c.image ?? null),
    ].filter((u): u is string => !!u),
  ),
];

/** The copy as markdown: headline, body, CTA and link, then each card. */
export function adCopy(ad: LibraryAd): string {
  const part = (label: string, v: string | null | undefined) =>
    v?.trim() ? `${label}: ${v.trim()}` : null;
  const head = [
    part("Headline", ad.headline),
    ad.body?.trim() ? `Body:\n${ad.body.trim()}` : null,
    part("CTA", ad.cta ?? ad.ctaType),
    part("Link", ad.link),
    part("Shown domain", ad.caption),
  ].filter(Boolean);
  const cards = (ad.cards ?? []).map((c, i) =>
    [
      `Card ${i + 1}`,
      part("  Headline", c.headline),
      part("  Body", c.body),
      part("  CTA", c.cta),
      part("  Link", c.link),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [...head, ...cards].join("\n");
}

/** What code knows of an ad, for the page's facts fence. */
export interface AdFacts {
  format: AdFormat | null;
  days_running: number | null;
  versions: number;
  platforms: string[];
  active: boolean;
  /** A video ad: someone speaks in it. Null for no video. */
  speech: boolean | null;
  /** A video ad: its scene cuts. Null for no video. */
  cuts: number | null;
}

export function adFacts(
  ad: LibraryAd,
  read: { speech: boolean | null; cuts: number | null },
): AdFacts {
  return {
    format: formatOf(ad.format),
    days_running: ad.daysRunning ?? null,
    versions: ad.versions ?? 1,
    platforms: ad.platforms ?? [],
    active: ad.active,
    speech: read.speech,
    cuts: read.cuts,
  };
}

/** The read page: the facts fence, the copy, then what the media showed and said. */
export function adPage(ad: LibraryAd, facts: AdFacts, media: string): string {
  return `## Ad\n\n\`\`\`json\n${JSON.stringify(facts)}\n\`\`\`\n\n## Copy\n\n${adCopy(ad) || "(no copy)"}\n\n${media.trim()}\n`;
}

/** An image or carousel ad, read by the eye in one call: each image's words and what it shows. */
export const adImagesSchema = z.object({
  images: z.array(z.object({ text: z.string(), shows: z.string() })),
});

export const adImagesPrompt = (n: number): string =>
  `These are the ${n} image(s) of one ad, in order. For each: every word on it as written, and what it shows (people, product, layout, colors). Answer {"images":[{"text":"...","shows":"..."}]}, one per image, in order.`;

/** The media part of an image ad's page. */
export const adImagesPage = (v: z.infer<typeof adImagesSchema>): string =>
  `## On screen\n\n${v.images
    .map((im, i) => `Image ${i + 1}\n  Shows: ${im.shows}\n  Text: ${im.text || "(none)"}`)
    .join("\n")}`;

/** The facts fence of an ad's page; null when it has none. */
export function adFactsOf(md: string): AdFacts | null {
  const m = /## Ad\n\n```json\n([\s\S]*?)\n```/.exec(md);
  if (!m) return null;
  try {
    return JSON.parse(m[1] as string) as AdFacts;
  } catch {
    return null;
  }
}
