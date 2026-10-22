/**
 * A connected TikTok's numbers on Account → Social: followers, likes and video count
 * (`user.info.stats`) and its newest videos with their views (`video.list`). Read live when the
 * page opens, through the client's own `socialSites` (the same calls the TikTok channel's
 * audience and metrics make), two calls per account. A scope the token lacks is said, never asked.
 */
import type { SiteClient } from "@wren/core/content";
import { loginOf } from "./access.js";
import type { SocialConnectionRow } from "./schema.js";

/** How many of its newest videos the page lists. */
export const TIKTOK_RECENT = 5;
/** Past this the page shows what it has: a slow TikTok never holds Account → Social. */
export const TIKTOK_NUMBERS_MS = 4_000;

export interface TikTokVideoLine {
  id: string;
  title: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** On tiktok.com; null when TikTok gave none. */
  url: string | null;
  /** Its cover at TikTok's CDN (https only). */
  cover: string | null;
  postedAt: string | null;
}

export interface TikTokNumbers {
  followers: number | null;
  likes: number | null;
  videos: number | null;
  recent: TikTokVideoLine[];
  /** Why a part is missing, said to a person: a scope, or TikTok not answering. */
  gaps: string[];
  asOf: string;
}

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const https = (v: unknown) => (typeof v === "string" && v.startsWith("https://") ? v : null);

const AGAIN = "Connect TikTok again to grant it.";

/** One video as `/v2/video/list/` answers it. */
export function videoLine(v: Json): TikTokVideoLine {
  const at = num(v.create_time);
  return {
    id: String(v.id ?? ""),
    title: str(v.title)?.slice(0, 140) ?? null,
    views: num(v.view_count),
    likes: num(v.like_count),
    comments: num(v.comment_count),
    url: https(v.share_url),
    cover: https(v.cover_image_url),
    postedAt: at ? new Date(at * 1000).toISOString() : null,
  };
}

/** The call, or its refusal once `ms` pass: a slow TikTok never holds the page. */
async function capped<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, no) => {
        timer = setTimeout(() => no(new Error("TikTok took too long")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The account's numbers now. A part that fails is a gap; the rest still shows. */
export async function tiktokNumbers(
  sites: SiteClient,
  c: Pick<SocialConnectionRow, "id" | "scopes">,
  o: { now: Date; ms?: number } = { now: new Date() },
): Promise<TikTokNumbers> {
  const granted = new Set(c.scopes.split(/[\s,]+/).filter(Boolean));
  const account = loginOf(c.id);
  const ms = o.ms ?? TIKTOK_NUMBERS_MS;
  const out: TikTokNumbers = {
    followers: null,
    likes: null,
    videos: null,
    recent: [],
    gaps: [],
    asOf: o.now.toISOString(),
  };
  /** One part: asked only with its scope; a refusal or a timeout is a gap, never a failure. */
  const part = async (what: string, scope: string, read: () => Promise<void>) => {
    if (!granted.has(scope)) {
      out.gaps.push(`${what} need ${scope}. ${AGAIN}`);
      return;
    }
    try {
      await capped(read(), ms);
    } catch (err) {
      out.gaps.push(`${what}: ${err instanceof Error ? err.message.slice(0, 1200) : "no answer"}`);
    }
  };

  await Promise.all([
    part("Followers", "user.info.stats", async () => {
      const r = await sites.call<{ data?: { user?: Json } }>(
        "tiktok",
        "GET",
        "/v2/user/info/",
        { fields: "open_id,follower_count,likes_count,video_count" },
        account,
      );
      const u = r.data?.user ?? {};
      out.followers = num(u.follower_count);
      out.likes = num(u.likes_count);
      out.videos = num(u.video_count);
    }),
    part("Videos", "video.list", async () => {
      const r = await sites.call<{ data?: { videos?: Json[] } }>(
        "tiktok",
        "POST",
        "/v2/video/list/",
        { max_count: TIKTOK_RECENT },
        account,
      );
      out.recent = (r.data?.videos ?? [])
        .slice(0, TIKTOK_RECENT)
        .map(videoLine)
        .filter((v) => v.id);
    }),
  ]);
  return out;
}
