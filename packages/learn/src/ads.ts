/**
 * Meta Ad Library ads as Learn items (designs/2026-11-11-competitor-ads.md): autobrowse's
 * `fb-public GET /ads` answer saved whole, one `ad` item and one `ads` row per ad; the page a read
 * writes (its `## Ad` facts fence feeds the breakdown's facts); the winners.
 */
import type { Db, Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Saved, saveLink } from "./items.js";
import { AD_FORMATS, type AdFormat, ads, items, itemTags, type Via } from "./schema.js";

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
/** The tags a winner gets: `learn promote` writes it to Canon as a reference. */
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

/**
 * Save one ad: its item (the copy as `text`, the video as `media_url`), its `ads` row with the
 * library record whole, and the winner tags when it is one. A pull again updates the numbers.
 */
export async function saveAd(
  db: Db,
  p: {
    client: string;
    ad: LibraryAd;
    pageId?: string | null;
    by: string | null;
    via: Via;
    now?: Date;
  },
): Promise<Saved & { winner: boolean }> {
  const { ad } = p;
  const now = p.now ?? new Date();
  const saved = await saveLink(db, {
    client: p.client,
    url: adUrl(ad.libraryId),
    by: p.by,
    via: p.via,
    kind: "ad",
    title: adTitle(ad),
    creator: ad.advertiser?.name ?? null,
    now,
  });
  const video = adVideos(ad)[0];
  await db
    .update(items)
    .set({
      text: pgSafe(adCopy(ad)),
      mediaUrl: video?.hd ?? video?.sd ?? null,
      thumbnailUrl: video?.poster ?? adImages(ad)[0] ?? null,
      ...(ad.started ? { publishedAt: new Date(`${ad.started}T00:00:00Z`) } : {}),
    })
    .where(eq(items.id, saved.id));
  const row = {
    client: p.client,
    libraryId: ad.libraryId,
    pageId: ad.advertiser?.id ?? p.pageId ?? null,
    advertiser: ad.advertiser?.name ?? null,
    active: ad.active,
    started: ad.started ?? null,
    ended: ad.ended ?? null,
    daysRunning: ad.daysRunning ?? null,
    versions: ad.versions ?? 1,
    platforms: ad.platforms ?? [],
    format: ad.format ?? null,
    raw: ad as Record<string, unknown>,
    seenAt: now,
  };
  await db
    .insert(ads)
    .values({ itemId: saved.id, ...row })
    .onConflictDoUpdate({ target: ads.itemId, set: row });
  const winner = isWinner(ad);
  if (winner)
    await db
      .insert(itemTags)
      .values(WINNER_TAGS.map((tag) => ({ itemId: saved.id, tag })))
      .onConflictDoNothing();
  return { ...saved, winner };
}

/** The winners in a workspace, longest running first; one advertiser's with `pageId`. */
export async function winningAds(
  db: Queryable,
  client: string,
  o: { pageId?: string; limit?: number } = {},
) {
  return db
    .select({
      id: items.id,
      title: items.title,
      url: items.url,
      advertiser: ads.advertiser,
      format: ads.format,
      daysRunning: ads.daysRunning,
      versions: ads.versions,
      active: ads.active,
      readAt: items.readAt,
    })
    .from(ads)
    .innerJoin(items, eq(items.id, ads.itemId))
    .innerJoin(itemTags, and(eq(itemTags.itemId, ads.itemId), eq(itemTags.tag, WINNER_TAGS[0])))
    .where(and(eq(ads.client, client), o.pageId ? eq(ads.pageId, o.pageId) : undefined))
    .orderBy(desc(sql`coalesce(${ads.daysRunning}, 0)`), desc(ads.versions))
    .limit(o.limit ?? 30);
}
